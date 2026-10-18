# LEGACY line — same source as `main`, retargeted for Windows 7+ and old hardware

`LEGACY` is `main` (the latest upstream VS Code snapshot, 1.143.0) plus a small **compatibility layer**. The NX layer
(extension, branding, docs, CI) is identical. `git diff main LEGACY` shows exactly what is different.

## What the compatibility layer changes
| Change | Why |
|---|---|
| `.npmrc` `target` 43.7.7 → **22.3.27**, `build/checksums/electron.txt` replaced with the real SHA-256 list of 22.3.27 | Electron 22 is the last line that runs on Windows 7/8/8.1 (Chromium 108, Node 16.17) |
| `src/tsconfig.base.json` target ES2024 → **ES2022** | syntax newer than ES2022 is down-levelled for Chromium 108 / Node 16 |
| `src/nx-compat/polyfills.ts`, imported first by `src/bootstrap-node.ts` (main, extension host, pty host…) and by the workbench window | `Array.toSorted/toReversed/toSpliced/with`, `Promise.withResolvers`, `AbortSignal.any/timeout`, `URL.canParse`, `Symbol.dispose/asyncDispose`, `structuredClone` — only the ones this tree uses; tested by `node nx/test-polyfills.mjs` |
| `preload.ts`: `webUtils.getPathForFile` falls back to `File.path` | `webUtils` exists only in Electron ≥ 32 |
| `product.json`: GPU terminal off, minimap off, separate installer GUIDs | weak hardware; lets LEGACY and main be installed side by side |
| `bin\nx-studio-code-safe.cmd` launcher, Safe Graphics Mode, Compatibility Doctor | old GPUs / broken drivers (same in `main`) |

## STATUS: first-pass port — NOT yet bootable-verified
Nothing here has been built or run (the author's machine cannot build VS Code, and no Windows 7 machine was available).
Measured gaps that still stand between this tree and a working Windows 7 build:

1. **`protocol.handle`** (Electron 25+) serves the `vscode-file://` protocol that loads the whole workbench
   (`src/vs/platform/protocol/electron-main/protocolMainService.ts`, 8 call sites). Needs a rewrite on `registerStreamProtocol`.
2. **`net.fetch`** (Electron 25+, 9 sites) and the missing global `fetch/Request/Response` in Node 16 (main process, extension host).
3. **CSS**: 64 stylesheets use features newer than Chromium 108 (`color-mix()`, `light-dark()` …). Needs a CSS down-levelling step in the build.
4. **Native modules** (`node-pty`, `@parcel/watcher`, `@vscode/spdlog` …) must compile against Electron 22 headers; the terminal on Windows 7 needs
   winpty, which current `node-pty` may no longer ship.
5. **Built-in extensions** are compiled for ES2024 / newer Node; they run inside the Electron-22 Node 16 extension host.
6. `WebContentsView` / `BaseWindow` (Electron 30+) are used by the integrated-browser feature (28 / 32 references) — that feature has to be disabled.
7. `build/gulpfile.vscode.ts` has no `win32-ia32` target any more, so **no 32-bit build** (the old 1.70.3 baseline had one: tag `legacy-1.70.3-baseline`).

Expect several build-and-fix rounds on a Windows machine. Until item 1–3 are solved, treat this branch as a work in progress, not a release.

## Other limits (unchanged by any patch)
- Chromium 108 receives no security fixes any more. Keep Workspace Trust on, do not open untrusted web content; prefer `main` wherever Windows 10+ is available.
- Chromium needs an SSE3-capable x86 CPU (roughly 2005+). Windows 7 needs SP1 and current updates (incl. KB2999226).
- The NX Python core runs on Python 3.8 (last Python for Windows 7); CI tests 3.8.
