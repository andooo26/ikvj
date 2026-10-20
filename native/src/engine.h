// GPU engine shared by the macOS (Metal + Syphon) and Windows (D3D11 + Spout)
// backends. Everything here is platform-neutral; addon.cc only talks to this.
//
// Model: the engine owns one output-sized render target per source slot
// (A..D) plus one for the mix. Sources write into their slot from a shared
// texture handle handed out by Electron's offscreen `paint` event; the mixer
// composites the slots bottom-to-top into the mix target; senders publish any
// target to Syphon / Spout. No pixel ever touches the CPU.

#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace ikvj {

constexpr int kNumSlots = 4;
constexpr int kMixTarget = kNumSlots;  // targets 0..3 = slots, 4 = mix
constexpr int kNumTargets = kNumSlots + 1;

enum class PixelFormat { kBGRA, kRGBA };

struct Layer {
  int slot;
  float opacity;  // 0..1, alpha-blended over everything below it
};

class Engine {
 public:
  // Returns nullptr and fills `error` on failure.
  static std::unique_ptr<Engine> Create(int width, int height, std::string* error);
  virtual ~Engine() = default;

  virtual const char* Backend() const = 0;
  virtual std::string Adapter() const = 0;

  // Draw an Electron shared texture into `slot`, scaled to fit and letterboxed
  // onto black. `handle` is the raw bytes of TextureInfo.handle.ioSurface
  // (macOS) or .ntHandle (Windows). Returns immediately; the GPU may still be
  // reading the texture. `*token` comes back from TakeCompleted() once it is
  // done, and only then may the caller release the texture to Electron.
  virtual bool SetSource(int slot, const uint8_t* handle, size_t handle_len,
                         PixelFormat format, uint32_t* token, std::string* error) = 0;

  // Tokens of SetSource calls whose GPU work has finished since the last call.
  virtual std::vector<uint32_t> TakeCompleted() = 0;

  // Block until all submitted GPU work is done (before releasing everything).
  virtual void Drain() = 0;

  // Fill a slot with a solid colour (self-test / "no signal").
  virtual bool FillSource(int slot, float r, float g, float b, std::string* error) = 0;

  // Composite `layers` (first = bottom) over black into the mix target.
  virtual bool Compose(const std::vector<Layer>& layers, std::string* error) = 0;

  // Senders are Syphon servers / Spout senders. Ids are > 0.
  virtual int CreateSender(const std::string& name, std::string* error) = 0;
  virtual bool Publish(int sender_id, int target, std::string* error) = 0;
  virtual void DestroySender(int sender_id) = 0;
  // 1 / 0, or -1 when the protocol cannot tell (Spout).
  virtual int HasClients(int sender_id) = 0;

  // A handle to `target` that Electron's sharedTexture.importSharedTexture can
  // take (IOSurfaceRef / NT HANDLE bytes), for GPU previews in the UI.
  virtual std::vector<uint8_t> SharedHandle(int target, std::string* error) = 0;

  // Read one BGRA pixel back to the CPU. Slow; tests only.
  virtual bool ReadPixel(int target, int x, int y, uint8_t out_bgra[4],
                         std::string* error) = 0;

 protected:
  Engine(int width, int height) : width_(width), height_(height) {}

  // Letterbox rect in NDC (x0, y0, x1, y1) for a src_w x src_h source.
  void FitRect(int src_w, int src_h, float rect[4]) const {
    float sx = static_cast<float>(width_) / src_w;
    float sy = static_cast<float>(height_) / src_h;
    float s = sx < sy ? sx : sy;
    float hw = src_w * s / width_;
    float hh = src_h * s / height_;
    rect[0] = -hw;
    rect[1] = -hh;
    rect[2] = hw;
    rect[3] = hh;
  }

  const int width_;
  const int height_;
};

// Names of currently announced Syphon servers (macOS); empty elsewhere.
std::vector<std::string> ListServers();

// Test helper: receive the Syphon server `name` as a client would and read
// one RGBA pixel of its latest frame. The first call connects; returns false
// until a frame has arrived. Always false on Windows.
bool ProbeReceive(const std::string& name, int x, int y, uint8_t out_rgba[4]);

}  // namespace ikvj
