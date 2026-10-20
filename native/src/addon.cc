// Node-API surface of the native engine. Platform-neutral: all GPU / Syphon /
// Spout work lives behind ikvj::Engine.
//
//   const { Engine, MIX, listServers } = require('ikvj_native.node')
//   const e = new Engine(1920, 1080)
//   e.setSource(slot, handleBuffer, 'bgra')   // from a paint event's texture
//   e.compose([{ slot: 0, opacity: 1 }, ...]) // bottom layer first
//   const id = e.createSender('ikvj-MIX'); e.publish(id, MIX)

#include <napi.h>

#include "engine.h"

namespace {

class EngineWrap : public Napi::ObjectWrap<EngineWrap> {
 public:
  static Napi::Function Define(Napi::Env env) {
    return DefineClass(
        env, "Engine",
        {
            InstanceAccessor<&EngineWrap::Backend>("backend"),
            InstanceAccessor<&EngineWrap::Adapter>("adapter"),
            InstanceMethod<&EngineWrap::SetSource>("setSource"),
            InstanceMethod<&EngineWrap::FillSource>("fillSource"),
            InstanceMethod<&EngineWrap::Compose>("compose"),
            InstanceMethod<&EngineWrap::CreateSender>("createSender"),
            InstanceMethod<&EngineWrap::Publish>("publish"),
            InstanceMethod<&EngineWrap::DestroySender>("destroySender"),
            InstanceMethod<&EngineWrap::HasClients>("hasClients"),
            InstanceMethod<&EngineWrap::SharedHandle>("sharedHandle"),
            InstanceMethod<&EngineWrap::ReadPixel>("readPixel"),
            InstanceMethod<&EngineWrap::Dispose>("dispose"),
        });
  }

  explicit EngineWrap(const Napi::CallbackInfo& info) : Napi::ObjectWrap<EngineWrap>(info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber()) {
      throw Napi::TypeError::New(env, "new Engine(width, height)");
    }
    int w = info[0].As<Napi::Number>().Int32Value();
    int h = info[1].As<Napi::Number>().Int32Value();
    if (w <= 0 || h <= 0 || w > 8192 || h > 8192) {
      throw Napi::RangeError::New(env, "Engine: bad size");
    }
    std::string error;
    engine_ = ikvj::Engine::Create(w, h, &error);
    if (!engine_) throw Napi::Error::New(env, error);
  }

 private:
  ikvj::Engine& Get(Napi::Env env) {
    if (!engine_) throw Napi::Error::New(env, "Engine is disposed");
    return *engine_;
  }

  static void Check(Napi::Env env, bool ok, const std::string& error) {
    if (!ok) throw Napi::Error::New(env, error);
  }

  static int Int(const Napi::CallbackInfo& info, size_t i, const char* usage) {
    if (info.Length() <= i || !info[i].IsNumber()) {
      throw Napi::TypeError::New(info.Env(), usage);
    }
    return info[i].As<Napi::Number>().Int32Value();
  }

  Napi::Value Backend(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), Get(info.Env()).Backend());
  }

  Napi::Value Adapter(const Napi::CallbackInfo& info) {
    return Napi::String::New(info.Env(), Get(info.Env()).Adapter());
  }

  void SetSource(const Napi::CallbackInfo& info) {
    const char* usage = "setSource(slot, handle: Buffer, pixelFormat: 'bgra' | 'rgba')";
    int slot = Int(info, 0, usage);
    if (info.Length() < 3 || !info[1].IsBuffer() || !info[2].IsString()) {
      throw Napi::TypeError::New(info.Env(), usage);
    }
    auto handle = info[1].As<Napi::Buffer<uint8_t>>();
    std::string fmt = info[2].As<Napi::String>();
    if (fmt != "bgra" && fmt != "rgba") {
      throw Napi::Error::New(info.Env(), "setSource: unsupported pixel format " + fmt);
    }
    std::string error;
    Check(info.Env(),
          Get(info.Env()).SetSource(slot, handle.Data(), handle.Length(),
                                    fmt == "rgba" ? ikvj::PixelFormat::kRGBA
                                                  : ikvj::PixelFormat::kBGRA,
                                    &error),
          error);
  }

  void FillSource(const Napi::CallbackInfo& info) {
    const char* usage = "fillSource(slot, r, g, b)  // 0..1";
    int slot = Int(info, 0, usage);
    float c[3];
    for (int i = 0; i < 3; ++i) {
      if (info.Length() <= static_cast<size_t>(i + 1) || !info[i + 1].IsNumber()) {
        throw Napi::TypeError::New(info.Env(), usage);
      }
      c[i] = info[i + 1].As<Napi::Number>().FloatValue();
    }
    std::string error;
    Check(info.Env(), Get(info.Env()).FillSource(slot, c[0], c[1], c[2], &error), error);
  }

  void Compose(const Napi::CallbackInfo& info) {
    const char* usage = "compose([{ slot, opacity }])  // bottom layer first";
    if (info.Length() < 1 || !info[0].IsArray()) {
      throw Napi::TypeError::New(info.Env(), usage);
    }
    auto arr = info[0].As<Napi::Array>();
    std::vector<ikvj::Layer> layers;
    for (uint32_t i = 0; i < arr.Length(); ++i) {
      Napi::Value v = arr[i];
      if (!v.IsObject()) throw Napi::TypeError::New(info.Env(), usage);
      auto o = v.As<Napi::Object>();
      Napi::Value slot = o.Get("slot");
      Napi::Value opacity = o.Get("opacity");
      if (!slot.IsNumber() || !opacity.IsNumber()) {
        throw Napi::TypeError::New(info.Env(), usage);
      }
      layers.push_back({slot.As<Napi::Number>().Int32Value(),
                        opacity.As<Napi::Number>().FloatValue()});
    }
    std::string error;
    Check(info.Env(), Get(info.Env()).Compose(layers, &error), error);
  }

  Napi::Value CreateSender(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) {
      throw Napi::TypeError::New(info.Env(), "createSender(name)");
    }
    std::string error;
    int id = Get(info.Env()).CreateSender(info[0].As<Napi::String>(), &error);
    Check(info.Env(), id > 0, error);
    return Napi::Number::New(info.Env(), id);
  }

  void Publish(const Napi::CallbackInfo& info) {
    const char* usage = "publish(senderId, target)";
    int id = Int(info, 0, usage);
    int target = Int(info, 1, usage);
    std::string error;
    Check(info.Env(), Get(info.Env()).Publish(id, target, &error), error);
  }

  void DestroySender(const Napi::CallbackInfo& info) {
    Get(info.Env()).DestroySender(Int(info, 0, "destroySender(senderId)"));
  }

  Napi::Value HasClients(const Napi::CallbackInfo& info) {
    int r = Get(info.Env()).HasClients(Int(info, 0, "hasClients(senderId)"));
    if (r < 0) return info.Env().Null();
    return Napi::Boolean::New(info.Env(), r == 1);
  }

  Napi::Value SharedHandle(const Napi::CallbackInfo& info) {
    std::string error;
    auto bytes = Get(info.Env()).SharedHandle(Int(info, 0, "sharedHandle(target)"), &error);
    Check(info.Env(), !bytes.empty(), error);
    return Napi::Buffer<uint8_t>::Copy(info.Env(), bytes.data(), bytes.size());
  }

  Napi::Value ReadPixel(const Napi::CallbackInfo& info) {
    const char* usage = "readPixel(target, x, y)";
    int target = Int(info, 0, usage);
    int x = Int(info, 1, usage);
    int y = Int(info, 2, usage);
    uint8_t bgra[4];
    std::string error;
    Check(info.Env(), Get(info.Env()).ReadPixel(target, x, y, bgra, &error), error);
    auto out = Napi::Array::New(info.Env(), 4);
    // Return RGBA, the order JS code expects.
    const int order[4] = {2, 1, 0, 3};
    for (uint32_t i = 0; i < 4; ++i) out[i] = Napi::Number::New(info.Env(), bgra[order[i]]);
    return out;
  }

  void Dispose(const Napi::CallbackInfo&) { engine_.reset(); }

  std::unique_ptr<ikvj::Engine> engine_;
};

Napi::Value ListServers(const Napi::CallbackInfo& info) {
  auto names = ikvj::ListServers();
  auto out = Napi::Array::New(info.Env(), names.size());
  for (uint32_t i = 0; i < names.size(); ++i) out[i] = Napi::String::New(info.Env(), names[i]);
  return out;
}

Napi::Value ProbeReceive(const Napi::CallbackInfo& info) {
  if (info.Length() < 3 || !info[0].IsString() || !info[1].IsNumber() || !info[2].IsNumber()) {
    throw Napi::TypeError::New(info.Env(), "probeReceive(name, x, y)");
  }
  uint8_t rgba[4];
  if (!ikvj::ProbeReceive(info[0].As<Napi::String>(), info[1].As<Napi::Number>().Int32Value(),
                          info[2].As<Napi::Number>().Int32Value(), rgba)) {
    return info.Env().Null();
  }
  auto out = Napi::Array::New(info.Env(), 4);
  for (uint32_t i = 0; i < 4; ++i) out[i] = Napi::Number::New(info.Env(), rgba[i]);
  return out;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("probeReceive", Napi::Function::New(env, ProbeReceive));
  exports.Set("Engine", EngineWrap::Define(env));
  exports.Set("MIX", Napi::Number::New(env, ikvj::kMixTarget));
  exports.Set("SLOTS", Napi::Number::New(env, ikvj::kNumSlots));
  exports.Set("listServers", Napi::Function::New(env, ListServers));
  return exports;
}

}  // namespace

NODE_API_MODULE(ikvj_native, Init)
