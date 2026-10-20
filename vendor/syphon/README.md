# Syphon.framework

Prebuilt universal (arm64 + x86_64) Syphon.framework with `SyphonMetalServer`,
taken from node-syphon's release asset
`https://github.com/benoitlahoz/node-syphon/releases/download/v1.1.5/SyphonFramework.zip`
(the same binary tubetosyphon used via node-syphon's postinstall).

Syphon is BSD-licensed: https://github.com/Syphon/Syphon-Framework

**Phase 0 only.** The official SDK release (v5, 2019) predates the Metal server,
and building from source needs full Xcode. For releases we will build
Syphon.framework from a pinned Syphon-Framework commit on a GitHub Actions macOS
runner and replace this copy.
