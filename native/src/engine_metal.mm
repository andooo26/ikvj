// macOS backend: Metal compositing, Syphon output.
//
// Every target (slots A..D + mix) is an IOSurface-backed MTLTexture, so any of
// them can also be handed back to Electron (sharedTexture.importSharedTexture)
// for a zero-copy preview. Shaders are compiled from source at startup, which
// keeps the build free of the `metal` CLI (not part of Command Line Tools).

#include "engine.h"

#import <Foundation/Foundation.h>
#import <IOSurface/IOSurface.h>
#import <Metal/Metal.h>
#import <OpenGL/OpenGL.h>
#import <OpenGL/gl.h>
#import <OpenGL/glext.h>
#import <Syphon/Syphon.h>

#include <map>
#include <mutex>

namespace ikvj {
namespace {

const char* const kShaderSource = R"(
#include <metal_stdlib>
using namespace metal;

struct Params {
  float4 rect;    // NDC x0, y0, x1, y1
  float opacity;
};

struct VOut {
  float4 pos [[position]];
  float2 uv;
};

vertex VOut quad_vs(uint vid [[vertex_id]], constant Params& p [[buffer(0)]]) {
  float2 c = float2(vid & 1, (vid >> 1) & 1);
  VOut o;
  o.pos = float4(mix(p.rect.x, p.rect.z, c.x), mix(p.rect.y, p.rect.w, c.y), 0.0, 1.0);
  o.uv = float2(c.x, 1.0 - c.y);  // texture rows run top-down
  return o;
}

fragment float4 quad_fs(VOut in [[stage_in]],
                        texture2d<float> tex [[texture(0)]],
                        constant Params& p [[buffer(0)]]) {
  constexpr sampler s(filter::linear, address::clamp_to_edge);
  return float4(tex.sample(s, in.uv).rgb, p.opacity);
}
)";

struct Params {
  float rect[4];
  float opacity;
  float pad[3];
};

void SetError(std::string* error, NSString* msg) {
  if (error) *error = msg.UTF8String;
}

class MetalEngine final : public Engine {
 public:
  MetalEngine(int width, int height) : Engine(width, height) {}

  ~MetalEngine() override {
    if (queue_) Drain();
    for (auto& [id, server] : senders_) [server stop];
    senders_.clear();
    for (IOSurfaceRef s : surfaces_) {
      if (s) CFRelease(s);
    }
  }

  bool Init(std::string* error) {
    device_ = MTLCreateSystemDefaultDevice();
    if (!device_) {
      SetError(error, @"Metal: no GPU device");
      return false;
    }
    queue_ = [device_ newCommandQueue];

    NSError* err = nil;
    id<MTLLibrary> lib = [device_ newLibraryWithSource:@(kShaderSource) options:nil error:&err];
    if (!lib) {
      SetError(error, [NSString stringWithFormat:@"Metal: shader compile failed: %@", err]);
      return false;
    }
    MTLRenderPipelineDescriptor* pd = [MTLRenderPipelineDescriptor new];
    pd.vertexFunction = [lib newFunctionWithName:@"quad_vs"];
    pd.fragmentFunction = [lib newFunctionWithName:@"quad_fs"];
    MTLRenderPipelineColorAttachmentDescriptor* ca = pd.colorAttachments[0];
    ca.pixelFormat = MTLPixelFormatBGRA8Unorm;
    ca.blendingEnabled = YES;
    ca.sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
    ca.destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    ca.sourceAlphaBlendFactor = MTLBlendFactorZero;  // keep the target opaque
    ca.destinationAlphaBlendFactor = MTLBlendFactorOne;
    pipeline_ = [device_ newRenderPipelineStateWithDescriptor:pd error:&err];
    if (!pipeline_) {
      SetError(error, [NSString stringWithFormat:@"Metal: pipeline failed: %@", err]);
      return false;
    }

    for (int i = 0; i < kNumTargets; ++i) {
      NSDictionary* props = @{
        (id)kIOSurfaceWidth : @(width_),
        (id)kIOSurfaceHeight : @(height_),
        (id)kIOSurfaceBytesPerElement : @4,
        (id)kIOSurfacePixelFormat : @((uint32_t)'BGRA'),
      };
      surfaces_[i] = IOSurfaceCreate((__bridge CFDictionaryRef)props);
      if (!surfaces_[i]) {
        SetError(error, @"Metal: IOSurfaceCreate failed");
        return false;
      }
      MTLTextureDescriptor* td =
          [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                             width:width_
                                                            height:height_
                                                         mipmapped:NO];
      td.usage = MTLTextureUsageRenderTarget | MTLTextureUsageShaderRead;
      td.storageMode = StorageMode();
      targets_[i] = [device_ newTextureWithDescriptor:td iosurface:surfaces_[i] plane:0];
      if (!targets_[i]) {
        SetError(error, @"Metal: target texture failed");
        return false;
      }
      std::string ignored;
      FillTarget(i, 0, 0, 0, &ignored);
    }
    return true;
  }

  const char* Backend() const override { return "metal"; }
  std::string Adapter() const override { return device_.name.UTF8String; }

  bool SetSource(int slot, const uint8_t* handle, size_t handle_len, PixelFormat format,
                 uint32_t* token, std::string* error) override {
    if (!ValidSlot(slot, error)) return false;
    if (handle_len < sizeof(IOSurfaceRef)) {
      SetError(error, @"SetSource: ioSurface handle too short");
      return false;
    }
    IOSurfaceRef surface;
    memcpy(&surface, handle, sizeof(surface));
    if (!surface) {
      SetError(error, @"SetSource: null IOSurface");
      return false;
    }
    int w = (int)IOSurfaceGetWidth(surface);
    int h = (int)IOSurfaceGetHeight(surface);
    MTLTextureDescriptor* td = [MTLTextureDescriptor
        texture2DDescriptorWithPixelFormat:format == PixelFormat::kRGBA ? MTLPixelFormatRGBA8Unorm
                                                                        : MTLPixelFormatBGRA8Unorm
                                     width:w
                                    height:h
                                 mipmapped:NO];
    td.usage = MTLTextureUsageShaderRead;
    td.storageMode = StorageMode();
    id<MTLTexture> src = [device_ newTextureWithDescriptor:td iosurface:surface plane:0];
    if (!src) {
      SetError(error, @"SetSource: could not wrap IOSurface");
      return false;
    }

    Params p{};
    FitRect(w, h, p.rect);
    p.opacity = 1;
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    id<MTLRenderCommandEncoder> enc = BeginPass(cb, slot, /*clear=*/true);
    Draw(enc, src, p);
    [enc endEncoding];
    uint32_t t = next_token_++;
    if (next_token_ == 0) next_token_ = 1;
    // Runs on a Metal thread; JS collects it via TakeCompleted().
    std::shared_ptr<Completed> done = completed_;
    [cb addCompletedHandler:^(id<MTLCommandBuffer>) {
      std::lock_guard<std::mutex> lock(done->mu);
      done->tokens.push_back(t);
    }];
    [cb commit];
    *token = t;
    return true;
  }

  std::vector<uint32_t> TakeCompleted() override {
    std::lock_guard<std::mutex> lock(completed_->mu);
    std::vector<uint32_t> out;
    out.swap(completed_->tokens);
    return out;
  }

  void Drain() override {
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    [cb commit];
    [cb waitUntilCompleted];  // the queue is serial, so everything before is done
  }

  bool FillSource(int slot, float r, float g, float b, std::string* error) override {
    if (!ValidSlot(slot, error)) return false;
    return FillTarget(slot, r, g, b, error);
  }

  bool Compose(const std::vector<Layer>& layers, std::string* error) override {
    for (const Layer& l : layers) {
      if (!ValidSlot(l.slot, error)) return false;
    }
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    id<MTLRenderCommandEncoder> enc = BeginPass(cb, kMixTarget, /*clear=*/true);
    for (const Layer& l : layers) {
      if (l.opacity <= 0) continue;
      Params p{{-1, -1, 1, 1}, l.opacity > 1 ? 1.0f : l.opacity, {}};
      Draw(enc, targets_[l.slot], p);
    }
    [enc endEncoding];
    [cb commit];  // ordered before any later publish on the same queue
    return true;
  }

  int CreateSender(const std::string& name, std::string* error) override {
    SyphonMetalServer* server =
        [[SyphonMetalServer alloc] initWithName:@(name.c_str()) device:device_ options:nil];
    if (!server) {
      SetError(error, @"Syphon: could not create server");
      return 0;
    }
    int id = next_sender_id_++;
    senders_[id] = server;
    return id;
  }

  bool Publish(int sender_id, int target, std::string* error) override {
    auto it = senders_.find(sender_id);
    if (it == senders_.end()) {
      SetError(error, @"Publish: unknown sender");
      return false;
    }
    if (!ValidTarget(target, error)) return false;
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    // Syphon frames follow OpenGL's bottom-up rows, which is what receivers
    // (VDMX, Resolume, ...) assume. Our targets are top-down, so flip on publish.
    [it->second publishFrameTexture:targets_[target]
                    onCommandBuffer:cb
                        imageRegion:NSMakeRect(0, 0, width_, height_)
                            flipped:YES];
    [cb commit];
    return true;
  }

  void DestroySender(int sender_id) override {
    auto it = senders_.find(sender_id);
    if (it == senders_.end()) return;
    [it->second stop];
    senders_.erase(it);
  }

  int HasClients(int sender_id) override {
    auto it = senders_.find(sender_id);
    return it != senders_.end() && it->second.hasClients ? 1 : 0;
  }

  std::vector<uint8_t> SharedHandle(int target, std::string* error) override {
    if (!ValidTarget(target, error)) return {};
    std::vector<uint8_t> bytes(sizeof(IOSurfaceRef));
    memcpy(bytes.data(), &surfaces_[target], sizeof(IOSurfaceRef));
    return bytes;
  }

  bool ReadPixel(int target, int x, int y, uint8_t out_bgra[4], std::string* error) override {
    if (!ValidTarget(target, error)) return false;
    if (x < 0 || y < 0 || x >= width_ || y >= height_) {
      SetError(error, @"ReadPixel: out of bounds");
      return false;
    }
    // Drain the queue so every submitted draw has landed in the IOSurface.
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    [cb commit];
    [cb waitUntilCompleted];
    IOSurfaceRef s = surfaces_[target];
    IOSurfaceLock(s, kIOSurfaceLockReadOnly, nullptr);
    const uint8_t* base = static_cast<const uint8_t*>(IOSurfaceGetBaseAddress(s));
    memcpy(out_bgra, base + y * IOSurfaceGetBytesPerRow(s) + x * 4, 4);
    IOSurfaceUnlock(s, kIOSurfaceLockReadOnly, nullptr);
    return true;
  }

 private:
  MTLStorageMode StorageMode() const {
    return device_.hasUnifiedMemory ? MTLStorageModeShared : MTLStorageModeManaged;
  }

  bool ValidSlot(int slot, std::string* error) const {
    if (slot >= 0 && slot < kNumSlots) return true;
    SetError(error, @"invalid slot");
    return false;
  }

  bool ValidTarget(int target, std::string* error) const {
    if (target >= 0 && target < kNumTargets) return true;
    SetError(error, @"invalid target");
    return false;
  }

  id<MTLRenderCommandEncoder> BeginPass(id<MTLCommandBuffer> cb, int target, bool clear,
                                        float r = 0, float g = 0, float b = 0) {
    MTLRenderPassDescriptor* rp = [MTLRenderPassDescriptor renderPassDescriptor];
    rp.colorAttachments[0].texture = targets_[target];
    rp.colorAttachments[0].loadAction = clear ? MTLLoadActionClear : MTLLoadActionLoad;
    rp.colorAttachments[0].clearColor = MTLClearColorMake(r, g, b, 1);
    rp.colorAttachments[0].storeAction = MTLStoreActionStore;
    return [cb renderCommandEncoderWithDescriptor:rp];
  }

  void Draw(id<MTLRenderCommandEncoder> enc, id<MTLTexture> tex, const Params& p) {
    [enc setRenderPipelineState:pipeline_];
    [enc setVertexBytes:&p length:sizeof(p) atIndex:0];
    [enc setFragmentBytes:&p length:sizeof(p) atIndex:0];
    [enc setFragmentTexture:tex atIndex:0];
    [enc drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4];
  }

  bool FillTarget(int target, float r, float g, float b, std::string*) {
    id<MTLCommandBuffer> cb = [queue_ commandBuffer];
    [BeginPass(cb, target, true, r, g, b) endEncoding];
    [cb commit];
    return true;
  }

  id<MTLDevice> device_ = nil;
  id<MTLCommandQueue> queue_ = nil;
  id<MTLRenderPipelineState> pipeline_ = nil;
  IOSurfaceRef surfaces_[kNumTargets] = {};
  id<MTLTexture> targets_[kNumTargets];
  std::map<int, SyphonMetalServer*> senders_;
  int next_sender_id_ = 1;

  // Shared with completion handlers, which may outlive a call but not the queue.
  struct Completed {
    std::mutex mu;
    std::vector<uint32_t> tokens;
  };
  std::shared_ptr<Completed> completed_ = std::make_shared<Completed>();
  uint32_t next_token_ = 1;
};

}  // namespace

std::unique_ptr<Engine> Engine::Create(int width, int height, std::string* error) {
  auto engine = std::make_unique<MetalEngine>(width, height);
  if (!engine->Init(error)) return nullptr;
  return engine;
}

std::vector<std::string> ListServers() {
  std::vector<std::string> names;
  for (NSDictionary* d in [SyphonServerDirectory sharedDirectory].servers) {
    NSString* name = d[SyphonServerDescriptionNameKey];
    NSString* app = d[SyphonServerDescriptionAppNameKey];
    names.push_back([NSString stringWithFormat:@"%@ / %@", app ?: @"", name ?: @""].UTF8String);
  }
  return names;
}

// Receives through SyphonOpenGLClient, the way VDMX / Resolume / most other
// receivers do, so the probe sees the frame in the orientation they show it.
bool ProbeReceive(const std::string& name, int x, int y, uint8_t out_rgba[4]) {
  static CGLContextObj context = [] {
    CGLPixelFormatAttribute attrs[] = {kCGLPFAAccelerated, kCGLPFAAllowOfflineRenderers,
                                       (CGLPixelFormatAttribute)0};
    CGLPixelFormatObj pf = nullptr;
    GLint count = 0;
    CGLContextObj ctx = nullptr;
    if (CGLChoosePixelFormat(attrs, &pf, &count) == kCGLNoError && pf) {
      CGLCreateContext(pf, nullptr, &ctx);
      CGLReleasePixelFormat(pf);
    }
    return ctx;
  }();
  static NSMutableDictionary<NSString*, SyphonOpenGLClient*>* clients = [NSMutableDictionary new];
  if (!context) return false;

  NSString* key = @(name.c_str());
  SyphonOpenGLClient* client = clients[key];
  if (!client) {
    for (NSDictionary* d in [SyphonServerDirectory sharedDirectory].servers) {
      if ([d[SyphonServerDescriptionNameKey] isEqualToString:key]) {
        client = [[SyphonOpenGLClient alloc] initWithServerDescription:d
                                                               context:context
                                                               options:nil
                                                       newFrameHandler:nil];
        if (client) clients[key] = client;
        break;
      }
    }
    return false;
  }
  SyphonOpenGLImage* frame = [client newFrameImage];
  if (!frame) return false;
  int w = (int)frame.textureSize.width;
  int h = (int)frame.textureSize.height;
  if (x < 0 || y < 0 || x >= w || y >= h) return false;

  CGLSetCurrentContext(context);
  GLuint fbo = 0;
  glGenFramebuffersEXT(1, &fbo);
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, fbo);
  glFramebufferTexture2DEXT(GL_FRAMEBUFFER_EXT, GL_COLOR_ATTACHMENT0_EXT,
                            GL_TEXTURE_RECTANGLE_EXT, frame.textureName, 0);
  // GL rows run bottom-up: image row y is GL row h - 1 - y.
  glReadPixels(x, h - 1 - y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, out_rgba);
  bool ok = glGetError() == GL_NO_ERROR;
  glBindFramebufferEXT(GL_FRAMEBUFFER_EXT, 0);
  glDeleteFramebuffersEXT(1, &fbo);
  CGLSetCurrentContext(nullptr);
  return ok;
}

}  // namespace ikvj
