{
  "targets": [
    {
      "target_name": "ikvj_native",
      "sources": ["src/addon.cc"],
      "include_dirs": ["<!(node -p \"require('node-addon-api').include_dir\")"],
      "defines": ["NAPI_VERSION=8", "NAPI_CPP_EXCEPTIONS"],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/engine_metal.mm"],
          "xcode_settings": {
            "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
            "CLANG_CXX_LANGUAGE_STANDARD": "c++17",
            "CLANG_ENABLE_OBJC_ARC": "YES",
            "MACOSX_DEPLOYMENT_TARGET": "12.0",
            "OTHER_CFLAGS": ["-F<(module_root_dir)/../vendor/syphon"],
            "OTHER_LDFLAGS": [
              "-F<(module_root_dir)/../vendor/syphon",
              "-framework Syphon",
              # Dev layout: native/build/Release/ikvj_native.node -> vendor/syphon.
              # Packaged builds get their own rpath in Phase 7.
              "-Wl,-rpath,@loader_path/../../../vendor/syphon"
            ]
          },
          "link_settings": {
            "libraries": [
              "-framework Foundation",
              "-framework Metal",
              "-framework IOSurface"
            ]
          }
        }],
        ["OS=='win'", {
          "sources": [
            "src/engine_d3d11.cc",
            "../vendor/spout2/SpoutDX.cpp",
            "../vendor/spout2/SpoutCopy.cpp",
            "../vendor/spout2/SpoutDirectX.cpp",
            "../vendor/spout2/SpoutFrameCount.cpp",
            "../vendor/spout2/SpoutSenderNames.cpp",
            "../vendor/spout2/SpoutSharedMemory.cpp",
            "../vendor/spout2/SpoutUtils.cpp"
          ],
          "include_dirs": ["../vendor/spout2"],
          "defines!": ["_HAS_EXCEPTIONS=0"],
          "libraries": ["d3d11.lib", "dxgi.lib", "d3dcompiler.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": ["/std:c++17"]
            }
          }
        }]
      ]
    }
  ]
}
