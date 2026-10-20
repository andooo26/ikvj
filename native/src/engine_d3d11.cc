// Windows backend: D3D11 compositing, Spout output.
//
// Mirrors engine_metal.mm. Targets are shareable (NT handle) textures so the
// UI can import them with Electron's sharedTexture API. Shaders are compiled
// at startup with D3DCompile (d3dcompiler_47.dll ships with Windows).

#include "SpoutDX.h"  // pulls in <windows.h> and <d3d11.h>; keep first

#include <d3d11_1.h>
#include <d3dcompiler.h>
#include <dxgi1_2.h>
#include <wrl/client.h>

#include <cstdio>
#include <cstring>
#include <map>

#include "engine.h"

using Microsoft::WRL::ComPtr;

namespace ikvj {
namespace {

const char kShaderSource[] = R"(
cbuffer Params : register(b0) {
  float4 rect;    // NDC x0, y0, x1, y1
  float opacity;
  float3 pad;
};
Texture2D tex : register(t0);
SamplerState samp : register(s0);

struct VOut {
  float4 pos : SV_Position;
  float2 uv : TEXCOORD0;
};

VOut quad_vs(uint vid : SV_VertexID) {
  float2 c = float2(vid & 1, (vid >> 1) & 1);
  VOut o;
  o.pos = float4(lerp(rect.x, rect.z, c.x), lerp(rect.y, rect.w, c.y), 0.0, 1.0);
  o.uv = float2(c.x, 1.0 - c.y);  // texture rows run top-down
  return o;
}

float4 quad_ps(VOut i) : SV_Target {
  return float4(tex.Sample(samp, i.uv).rgb, opacity);
}
)";

struct Params {
  float rect[4];
  float opacity;
  float pad[3];
};

std::string Hr(const char* what, HRESULT hr) {
  char buf[160];
  snprintf(buf, sizeof(buf), "%s failed (HRESULT 0x%08lX)", what, static_cast<unsigned long>(hr));
  return buf;
}

std::string Utf8(const wchar_t* w) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, -1, nullptr, 0, nullptr, nullptr);
  if (n <= 1) return {};
  std::string s(n - 1, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, -1, &s[0], n, nullptr, nullptr);
  return s;
}

struct Target {
  ComPtr<ID3D11Texture2D> tex;
  ComPtr<ID3D11RenderTargetView> rtv;
  ComPtr<ID3D11ShaderResourceView> srv;
  HANDLE shared = nullptr;  // created lazily by SharedHandle()
};

class D3D11Engine final : public Engine {
 public:
  D3D11Engine(int width, int height) : Engine(width, height) {}

  ~D3D11Engine() override {
    if (ctx_ && fence_) Drain();
    for (auto& [id, sender] : senders_) {
      sender->ReleaseSender();
      sender->CloseDirectX11();
      delete sender;
    }
    senders_.clear();
    for (Target& t : targets_) {
      if (t.shared) CloseHandle(t.shared);
    }
  }

  bool Init(std::string* error) {
    const D3D_FEATURE_LEVEL levels[] = {D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0};
    const UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
    HRESULT hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels,
                                   ARRAYSIZE(levels), D3D11_SDK_VERSION, &device_, nullptr,
                                   &ctx_);
    if (FAILED(hr)) {
      // No GPU (e.g. CI runners): fall back to the software rasterizer.
      hr = D3D11CreateDevice(nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags, levels,
                             ARRAYSIZE(levels), D3D11_SDK_VERSION, &device_, nullptr, &ctx_);
    }
    if (FAILED(hr)) return Fail(error, Hr("D3D11CreateDevice", hr));
    if (FAILED(hr = device_.As(&device1_))) return Fail(error, Hr("ID3D11Device1", hr));

    ComPtr<IDXGIDevice> dxgi;
    ComPtr<IDXGIAdapter> adapter;
    DXGI_ADAPTER_DESC desc{};
    if (SUCCEEDED(device_.As(&dxgi)) && SUCCEEDED(dxgi->GetAdapter(&adapter)) &&
        SUCCEEDED(adapter->GetDesc(&desc))) {
      adapter_name_ = Utf8(desc.Description);
    }

    ComPtr<ID3DBlob> vs_blob, ps_blob, log;
    hr = D3DCompile(kShaderSource, sizeof(kShaderSource) - 1, "ikvj", nullptr, nullptr,
                    "quad_vs", "vs_5_0", 0, 0, &vs_blob, &log);
    if (FAILED(hr)) return Fail(error, CompileError("vertex shader", hr, log.Get()));
    hr = D3DCompile(kShaderSource, sizeof(kShaderSource) - 1, "ikvj", nullptr, nullptr,
                    "quad_ps", "ps_5_0", 0, 0, &ps_blob, &log);
    if (FAILED(hr)) return Fail(error, CompileError("pixel shader", hr, log.Get()));
    if (FAILED(hr = device_->CreateVertexShader(vs_blob->GetBufferPointer(),
                                                vs_blob->GetBufferSize(), nullptr, &vs_)) ||
        FAILED(hr = device_->CreatePixelShader(ps_blob->GetBufferPointer(),
                                               ps_blob->GetBufferSize(), nullptr, &ps_))) {
      return Fail(error, Hr("CreateShader", hr));
    }

    D3D11_BUFFER_DESC cbd{};
    cbd.ByteWidth = sizeof(Params);
    cbd.Usage = D3D11_USAGE_DYNAMIC;
    cbd.BindFlags = D3D11_BIND_CONSTANT_BUFFER;
    cbd.CPUAccessFlags = D3D11_CPU_ACCESS_WRITE;
    if (FAILED(hr = device_->CreateBuffer(&cbd, nullptr, &cbuf_))) {
      return Fail(error, Hr("CreateBuffer", hr));
    }

    D3D11_SAMPLER_DESC sd{};
    sd.Filter = D3D11_FILTER_MIN_MAG_MIP_LINEAR;
    sd.AddressU = sd.AddressV = sd.AddressW = D3D11_TEXTURE_ADDRESS_CLAMP;
    sd.MaxLOD = D3D11_FLOAT32_MAX;
    if (FAILED(hr = device_->CreateSamplerState(&sd, &sampler_))) {
      return Fail(error, Hr("CreateSamplerState", hr));
    }

    D3D11_BLEND_DESC bd{};
    D3D11_RENDER_TARGET_BLEND_DESC& rt = bd.RenderTarget[0];
    rt.BlendEnable = TRUE;
    rt.SrcBlend = D3D11_BLEND_SRC_ALPHA;
    rt.DestBlend = D3D11_BLEND_INV_SRC_ALPHA;
    rt.BlendOp = D3D11_BLEND_OP_ADD;
    rt.SrcBlendAlpha = D3D11_BLEND_ZERO;  // keep the target opaque
    rt.DestBlendAlpha = D3D11_BLEND_ONE;
    rt.BlendOpAlpha = D3D11_BLEND_OP_ADD;
    rt.RenderTargetWriteMask = D3D11_COLOR_WRITE_ENABLE_ALL;
    if (FAILED(hr = device_->CreateBlendState(&bd, &blend_))) {
      return Fail(error, Hr("CreateBlendState", hr));
    }

    D3D11_RASTERIZER_DESC rd{};
    rd.FillMode = D3D11_FILL_SOLID;
    rd.CullMode = D3D11_CULL_NONE;  // the strip's winding flips between its triangles
    if (FAILED(hr = device_->CreateRasterizerState(&rd, &raster_))) {
      return Fail(error, Hr("CreateRasterizerState", hr));
    }

    D3D11_QUERY_DESC qd{D3D11_QUERY_EVENT, 0};
    if (FAILED(hr = device_->CreateQuery(&qd, &fence_))) {
      return Fail(error, Hr("CreateQuery", hr));
    }

    for (int i = 0; i < kNumTargets; ++i) {
      D3D11_TEXTURE2D_DESC td{};
      td.Width = width_;
      td.Height = height_;
      td.MipLevels = 1;
      td.ArraySize = 1;
      td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
      td.SampleDesc.Count = 1;
      td.Usage = D3D11_USAGE_DEFAULT;
      td.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
      td.MiscFlags = D3D11_RESOURCE_MISC_SHARED | D3D11_RESOURCE_MISC_SHARED_NTHANDLE;
      Target& t = targets_[i];
      if (FAILED(hr = device_->CreateTexture2D(&td, nullptr, &t.tex)) ||
          FAILED(hr = device_->CreateRenderTargetView(t.tex.Get(), nullptr, &t.rtv)) ||
          FAILED(hr = device_->CreateShaderResourceView(t.tex.Get(), nullptr, &t.srv))) {
        return Fail(error, Hr("create target", hr));
      }
      Clear(i, 0, 0, 0);
    }
    return true;
  }

  const char* Backend() const override { return "d3d11"; }
  std::string Adapter() const override { return adapter_name_; }

  bool SetSource(int slot, const uint8_t* handle, size_t handle_len, PixelFormat,
                 uint32_t* token, std::string* error) override {
    if (!ValidSlot(slot, error)) return false;
    if (handle_len < sizeof(HANDLE)) return Fail(error, "SetSource: ntHandle too short");
    HANDLE h;
    memcpy(&h, handle, sizeof(h));

    ComPtr<ID3D11Texture2D> src;
    HRESULT hr = device1_->OpenSharedResource1(h, IID_PPV_ARGS(&src));
    if (FAILED(hr)) {
      // Most likely the texture lives on another GPU than ours (hybrid laptops).
      return Fail(error, Hr("OpenSharedResource1", hr));
    }
    D3D11_TEXTURE2D_DESC desc;
    src->GetDesc(&desc);
    ComPtr<ID3D11ShaderResourceView> srv;
    if (FAILED(hr = device_->CreateShaderResourceView(src.Get(), nullptr, &srv))) {
      return Fail(error, Hr("CreateShaderResourceView(source)", hr));
    }

    Params p{};
    FitRect(static_cast<int>(desc.Width), static_cast<int>(desc.Height), p.rect);
    p.opacity = 1;
    Clear(slot, 0, 0, 0);
    BindTarget(slot);
    Draw(srv.Get(), p);

    // An event query marks the end of this draw; TakeCompleted() polls it.
    Pending pending;
    if (!free_queries_.empty()) {
      pending.query = std::move(free_queries_.back());
      free_queries_.pop_back();
    } else {
      D3D11_QUERY_DESC qd{D3D11_QUERY_EVENT, 0};
      if (FAILED(hr = device_->CreateQuery(&qd, &pending.query))) {
        return Fail(error, Hr("CreateQuery", hr));
      }
    }
    ctx_->End(pending.query.Get());
    ctx_->Flush();
    pending.source = src;  // keep the opened texture alive until the GPU is done
    pending.token = next_token_++;
    if (next_token_ == 0) next_token_ = 1;
    *token = pending.token;
    pending_.push_back(std::move(pending));
    return true;
  }

  std::vector<uint32_t> TakeCompleted() override {
    std::vector<uint32_t> out;
    // Queries finish in submission order, so stop at the first one still busy.
    size_t done = 0;
    for (; done < pending_.size(); ++done) {
      if (ctx_->GetData(pending_[done].query.Get(), nullptr, 0,
                        D3D11_ASYNC_GETDATA_DONOTFLUSH) != S_OK) {
        break;
      }
      out.push_back(pending_[done].token);
      free_queries_.push_back(std::move(pending_[done].query));
    }
    pending_.erase(pending_.begin(), pending_.begin() + done);
    return out;
  }

  void Drain() override {
    WaitIdle();
    for (Pending& p : pending_) free_queries_.push_back(std::move(p.query));
    pending_.clear();
  }

  bool FillSource(int slot, float r, float g, float b, std::string* error) override {
    if (!ValidSlot(slot, error)) return false;
    Clear(slot, r, g, b);
    return true;
  }

  bool Compose(const std::vector<Layer>& layers, std::string* error) override {
    for (const Layer& l : layers) {
      if (!ValidSlot(l.slot, error)) return false;
    }
    Clear(kMixTarget, 0, 0, 0);
    BindTarget(kMixTarget);
    for (const Layer& l : layers) {
      if (l.opacity <= 0) continue;
      Params p{{-1, -1, 1, 1}, l.opacity > 1 ? 1.0f : l.opacity, {}};
      Draw(targets_[l.slot].srv.Get(), p);
    }
    // Unbind so the mix target can be read (published) without a hazard.
    ID3D11RenderTargetView* none = nullptr;
    ctx_->OMSetRenderTargets(1, &none, nullptr);
    return true;
  }

  int CreateSender(const std::string& name, std::string* error) override {
    spoutDX* sender = new spoutDX();
    if (!sender->OpenDirectX11(device_.Get())) {
      delete sender;
      Fail(error, "Spout: OpenDirectX11 failed");
      return 0;
    }
    sender->SetSenderName(name.c_str());
    int id = next_sender_id_++;
    senders_[id] = sender;
    return id;
  }

  bool Publish(int sender_id, int target, std::string* error) override {
    auto it = senders_.find(sender_id);
    if (it == senders_.end()) return Fail(error, "Publish: unknown sender");
    if (!ValidTarget(target, error)) return false;
    if (!it->second->SendTexture(targets_[target].tex.Get())) {
      return Fail(error, "Spout: SendTexture failed");
    }
    return true;
  }

  void DestroySender(int sender_id) override {
    auto it = senders_.find(sender_id);
    if (it == senders_.end()) return;
    it->second->ReleaseSender();
    it->second->CloseDirectX11();
    delete it->second;
    senders_.erase(it);
  }

  int HasClients(int) override { return -1; }  // Spout can't tell

  std::vector<uint8_t> SharedHandle(int target, std::string* error) override {
    if (!ValidTarget(target, error)) return {};
    Target& t = targets_[target];
    if (!t.shared) {
      ComPtr<IDXGIResource1> res;
      HRESULT hr = t.tex.As(&res);
      if (SUCCEEDED(hr)) {
        hr = res->CreateSharedHandle(nullptr, DXGI_SHARED_RESOURCE_READ, nullptr, &t.shared);
      }
      if (FAILED(hr)) {
        Fail(error, Hr("CreateSharedHandle", hr));
        return {};
      }
    }
    std::vector<uint8_t> bytes(sizeof(HANDLE));
    memcpy(bytes.data(), &t.shared, sizeof(HANDLE));
    return bytes;
  }

  bool ReadPixel(int target, int x, int y, uint8_t out_bgra[4], std::string* error) override {
    if (!ValidTarget(target, error)) return false;
    if (x < 0 || y < 0 || x >= width_ || y >= height_) {
      return Fail(error, "ReadPixel: out of bounds");
    }
    D3D11_TEXTURE2D_DESC td{};
    td.Width = td.Height = 1;
    td.MipLevels = td.ArraySize = 1;
    td.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
    td.SampleDesc.Count = 1;
    td.Usage = D3D11_USAGE_STAGING;
    td.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
    ComPtr<ID3D11Texture2D> staging;
    HRESULT hr = device_->CreateTexture2D(&td, nullptr, &staging);
    if (FAILED(hr)) return Fail(error, Hr("CreateTexture2D(staging)", hr));
    D3D11_BOX box{static_cast<UINT>(x), static_cast<UINT>(y), 0,
                  static_cast<UINT>(x + 1), static_cast<UINT>(y + 1), 1};
    ctx_->CopySubresourceRegion(staging.Get(), 0, 0, 0, 0, targets_[target].tex.Get(), 0, &box);
    D3D11_MAPPED_SUBRESOURCE m;
    if (FAILED(hr = ctx_->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &m))) {
      return Fail(error, Hr("Map", hr));
    }
    memcpy(out_bgra, m.pData, 4);
    ctx_->Unmap(staging.Get(), 0);
    return true;
  }

 private:
  static bool Fail(std::string* error, const std::string& msg) {
    if (error) *error = msg;
    return false;
  }

  static std::string CompileError(const char* what, HRESULT hr, ID3DBlob* log) {
    std::string msg = Hr(what, hr);
    if (log) msg += ": " + std::string(static_cast<const char*>(log->GetBufferPointer()),
                                       log->GetBufferSize());
    return msg;
  }

  bool ValidSlot(int slot, std::string* error) const {
    return (slot >= 0 && slot < kNumSlots) || Fail(error, "invalid slot");
  }

  bool ValidTarget(int target, std::string* error) const {
    return (target >= 0 && target < kNumTargets) || Fail(error, "invalid target");
  }

  void Clear(int target, float r, float g, float b) {
    const float c[4] = {r, g, b, 1};
    ctx_->ClearRenderTargetView(targets_[target].rtv.Get(), c);
  }

  void BindTarget(int target) {
    ID3D11RenderTargetView* rtv = targets_[target].rtv.Get();
    ctx_->OMSetRenderTargets(1, &rtv, nullptr);
    D3D11_VIEWPORT vp{0, 0, static_cast<float>(width_), static_cast<float>(height_), 0, 1};
    ctx_->RSSetViewports(1, &vp);
    ctx_->RSSetState(raster_.Get());
    const float factor[4] = {0, 0, 0, 0};
    ctx_->OMSetBlendState(blend_.Get(), factor, 0xffffffff);
    ctx_->IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
    ctx_->IASetInputLayout(nullptr);
    ctx_->VSSetShader(vs_.Get(), nullptr, 0);
    ctx_->PSSetShader(ps_.Get(), nullptr, 0);
    ctx_->VSSetConstantBuffers(0, 1, cbuf_.GetAddressOf());
    ctx_->PSSetConstantBuffers(0, 1, cbuf_.GetAddressOf());
    ctx_->PSSetSamplers(0, 1, sampler_.GetAddressOf());
  }

  void Draw(ID3D11ShaderResourceView* srv, const Params& p) {
    D3D11_MAPPED_SUBRESOURCE m;
    if (SUCCEEDED(ctx_->Map(cbuf_.Get(), 0, D3D11_MAP_WRITE_DISCARD, 0, &m))) {
      memcpy(m.pData, &p, sizeof(p));
      ctx_->Unmap(cbuf_.Get(), 0);
    }
    ctx_->PSSetShaderResources(0, 1, &srv);
    ctx_->Draw(4, 0);
    ID3D11ShaderResourceView* none = nullptr;
    ctx_->PSSetShaderResources(0, 1, &none);
  }

  void WaitIdle() {
    ctx_->End(fence_.Get());
    ctx_->Flush();
    BOOL done = FALSE;
    while (ctx_->GetData(fence_.Get(), &done, sizeof(done), 0) == S_FALSE) {
      YieldProcessor();
    }
  }

  ComPtr<ID3D11Device> device_;
  ComPtr<ID3D11Device1> device1_;
  ComPtr<ID3D11DeviceContext> ctx_;
  ComPtr<ID3D11VertexShader> vs_;
  ComPtr<ID3D11PixelShader> ps_;
  ComPtr<ID3D11Buffer> cbuf_;
  ComPtr<ID3D11SamplerState> sampler_;
  ComPtr<ID3D11BlendState> blend_;
  ComPtr<ID3D11RasterizerState> raster_;
  ComPtr<ID3D11Query> fence_;
  Target targets_[kNumTargets];

  struct Pending {
    uint32_t token = 0;
    ComPtr<ID3D11Query> query;
    ComPtr<ID3D11Texture2D> source;
  };
  std::vector<Pending> pending_;
  std::vector<ComPtr<ID3D11Query>> free_queries_;
  uint32_t next_token_ = 1;
  std::map<int, spoutDX*> senders_;
  std::string adapter_name_;
  int next_sender_id_ = 1;
};

}  // namespace

std::unique_ptr<Engine> Engine::Create(int width, int height, std::string* error) {
  auto engine = std::make_unique<D3D11Engine>(width, height);
  if (!engine->Init(error)) return nullptr;
  return engine;
}

std::vector<std::string> ListServers() { return {}; }

bool ProbeReceive(const std::string&, int, int, uint8_t[4]) { return false; }

}  // namespace ikvj
