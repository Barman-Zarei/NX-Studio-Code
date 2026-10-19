# LEGACY line — latest VS Code source, retargeted for Windows 7+ and old hardware

`LEGACY` is `main` (latest upstream snapshot, VS Code 1.143.0) plus a **compatibility layer** that retargets it to
**Electron 22.3.27** (Chromium 108, Node 16.17), the last Electron line that runs on Windows 7/8/8.1.
The NX layer (extension, branding, docs) is identical to `main`; `git diff main LEGACY` shows exactly what differs.
The earlier approach (VS Code 1.70.3 as the engine) is kept as git tag `legacy-1.70.3-baseline`.

## What the compatibility layer does
| Area | Change | Verified how |
|---|---|---|
| Engine | `.npmrc` target → 22.3.27; `build/checksums/electron.txt` = real SHA-256 list of 22.3.27 | checksums fetched from the official release |
| Main process is ESM, Electron 22 can't load ESM (needs ≥ 28) | `build/next/nx-legacy.ts` + `build/next/index.ts`: every node-side bundle is emitted as **CommonJS** (`import()` → `require`, `import.meta.*` shimmed, Node 16.17 target); packaged `package.json` gets `"type": "commonjs"`; top-level `await` in `main.ts`, `cli.ts`, `bootstrap-fork.ts` rewritten as async functions | `nx/verify-cjs-bundles.mjs`: **all 13 node entry points bundle to valid CJS** with the real build options |
| Renderer | bundles lowered to `chrome108`; transpile target ES2024 → ES2022 (also for built-in extensions) | workbench + workbench.desktop.main bundle without errors |
| Missing runtime APIs | `src/nx-compat/polyfills.ts` (toSorted, withResolvers, AbortSignal.any, URL.canParse, Symbol.dispose, structuredClone …) | `nx/test-polyfills.mjs` (13 checks) |
| No `fetch/Request/Response` in Node 16 | `src/nx-compat/fetch-node.ts` (http/https/file/data, redirects, Range, gzip/br, abort) | `nx/test-compat.mjs` against a real HTTP server and files |
| `protocol.handle`, `unhandle`, `net.fetch` (Electron 25+) | `src/nx-compat/electron-shims.ts` on top of stream/intercept protocols | `nx/test-compat.mjs` against a fake `Protocol` (23 checks total) |
| `webUtils.getPathForFile` (Electron 32+) | `File.path` fallback in `preload.ts` | code review only |
| CSS `color-mix()` (Chromium 111) | `nx/css-fallback.cjs` inserted 173 fallback declarations in 62 stylesheets (dominant colour; faint tints degrade to `transparent`) | idempotent script; 33 uses (inside `@supports` / multi-line) are not covered |
| Weak hardware | GPU terminal off, minimap off, separate installer GUIDs, `nx-studio-code-safe.cmd`, Safe Graphics Mode, Compatibility Doctor | — |

## Electron API audit (`nx/audit-electron-api.cjs`)
A type-level audit of the 54 source files that use Electron, against the Electron 22.3.27 typings, found **34 distinct APIs that do not exist in Electron 22**. Handled:
- **Shimmed** (`src/nx-compat/electron-shims.ts`, 31 checks in `nx/test-compat.mjs`): `Protocol.handle/unhandle`, `net.fetch`, `WebFrameMain.isDestroyed/collectJavaScriptCallStack`, `app.resolveProxy/setProxy/setDesktopName`, `contentTracing.enableHeapProfiling`, `BrowserWindow.setAccentColor`, `powerMonitor.getCurrentThermalState`.
- **Integrated browser disabled** (17 of the 34 live in `platform/browserView`; it needs `WebContentsView`/`BaseWindow`, Electron 30+): its IPC channels are only registered when Electron ≥ 30 (`src/nx-compat/support.ts`). The UI entry points may still be visible and will fail when used.
- **Typing-only or harmless at runtime**: `EventEmitter` methods missing from the typings (`off`, `emit`, `removeAllListeners`), type-only imports (`BaseWindow`), unknown option keys that Electron ignores (`codeCache`, `enableDeprecatedPaste`, `respondToAuthRequestsFromMainProcess`), macOS-only calls.
- **Terminal without ConPTY**: `node-pty` 1.2 ships only ConPTY (Windows 10 1809+), no winpty. On older Windows, `terminalProcess.ts` falls back to `src/nx-compat/pipePty.ts`, a basic piped terminal (local echo and line editing, no colours from TTY-aware programs, Ctrl+C cannot interrupt, no full-screen programs).

## STATUS: not yet built or booted
Everything above was checked with the scripts named here, on a machine that cannot run the full VS Code build and has no Windows 7.
**The editor has never been built or started from this branch.** Open items, all of which need a real build or a real Windows 7 machine:

1. The full gulp pipeline (`build.yml`) has not run: interplay of NLS / private-field-mangling post-processing with CommonJS output is untested.
2. Runtime behaviour of the shims inside real Electron 22 (stream-protocol semantics for media/webviews, `session-created` timing) is untested; `fetch` has no system-proxy support.
3. Native modules must compile against Electron 22 headers.
4. Features that need newer runtimes will not work: the agent host / Copilot SDK (Node 16 is too old; it starts lazily, so only its own process fails), extensions requiring Node 18+ APIs, the integrated browser (see above).
5. Web-platform features newer than Chromium 108 beyond CSS `color-mix()` were not audited (33 `color-mix()` uses inside `@supports` / multi-line declarations have no fallback).
6. No 32-bit (ia32) build: upstream's gulp tasks have no `win32-ia32` target any more.
7. `server-main.ts` / `server-cli.ts` (remote server) still use top-level `await`; server targets are not part of LEGACY.

## Limits no patch can remove
- Chromium 108 receives no security fixes. Keep Workspace Trust on, avoid untrusted web content; prefer `main` wherever Windows 10+ is available.
- Chromium needs an SSE3-capable x86 CPU (roughly 2005+). Windows 7 needs SP1 and current updates (incl. KB2999226).
- The NX Python core runs on Python 3.8 (last Python for Windows 7); CI tests 3.8.

## Checks you can run (no full build needed)
```
node nx/test-polyfills.mjs && node nx/test-compat.mjs          # Node >= 22.18
ESBUILD=<path to esbuild package> node nx/verify-cjs-bundles.mjs
node nx/css-fallback.cjs src --check
TYPESCRIPT=<typescript pkg> ELECTRON_DTS=<electron@22.3.27 electron.d.ts> node nx/audit-electron-api.cjs
```
