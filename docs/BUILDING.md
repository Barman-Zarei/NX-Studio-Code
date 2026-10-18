# Building

| | main | LEGACY |
|---|---|---|
| Upstream base | current VS Code `main` snapshot (1.143.0 at import) | VS Code 1.70.3 |
| Node | `.nvmrc` (24.x) | 16.14.2 |
| Package manager | `npm ci` | `yarn --frozen-lockfile --check-files` |
| RAM for the build | ≥ 8 GB | ≥ 6 GB |
| Build task | `npm run gulp vscode-<os>-<arch>-min` | `yarn gulp vscode-<os>-<arch>-min` |
| Windows setup | `…-win32-<arch>-inno-updater`, `…-archive`, `…-user-setup` | same, arch `ia32` or `x64` |

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
