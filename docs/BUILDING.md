# Building

| | main | LEGACY |
|---|---|---|
| Upstream base | current VS Code snapshot (1.143.0 at import) | same snapshot + compatibility layer |
| Node (build host) | `.nvmrc` (24.x) | `.nvmrc` (24.x); Electron target 22.3.27 (`.npmrc`) |
| Package manager | `npm ci` | `npm ci` |
| RAM for the build | ≥ 8 GB | ≥ 8 GB |
| Build task | `npm run gulp vscode-<os>-<arch>-min` | same (win32 x64 only) |
| Windows setup | `…-win32-<arch>-inno-updater`, `…-archive`, `…-user-setup` | same |

Windows needs Python 3 and Visual Studio Build Tools (C++); Linux needs `build-essential pkg-config libx11-dev libxkbfile-dev libsecret-1-dev libkrb5-dev`.
GitHub Actions: `.github/workflows/build.yml` (manual or on `v*` tag) and `ci.yml` (NX core tests on Python 3.8/3.12, Windows+Linux; CI Doctor on our own workflows).

**Status:** `ci.yml` jobs are plain Python/Node and are expected to pass; `build.yml` was written from upstream's pipelines but never executed.

Quick local check of the NX layer (no full build needed):
```
cd extensions/nx-studio/python && python -m unittest discover -s tests -v
node extensions/nx-studio/test/smoke.js
```
Version note: the engine version in `package.json` stays upstream's so extension compatibility checks keep working;
the NX release version (1.0.0) is `product.json › nxVersion` and shows in the status bar and **NX: About**.
Branding is re-applied idempotently with `node nx/brand.cjs . main|legacy`.
