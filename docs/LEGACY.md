# LEGACY line — Windows 7 and old hardware

**Base:** VS Code 1.70.3 (Electron 18.3.5, Node 16.14). This is generally cited as the last upstream line that runs on
Windows 7 / 8 / 8.1; newer Electron versions dropped them. Builds: **win32 ia32 (32-bit), win32 x64**, linux x64.

## What the branch does for old machines
- 32-bit installer/zip for 32-bit-only PCs.
- `bin\nx-studio-code-safe.cmd` launcher: starts with `--disable-gpu --disable-gpu-compositing` (old GPUs / broken drivers).
- Defaults tuned for weak hardware: GPU terminal off, minimap off, telemetry off, no update checks. Studio profiles
  `low-resource` and `legacy-safe`; `NX: Compatibility Doctor` and `NX: Safe Graphics Mode` commands.
- The NX core runs on Python **3.8** (last Python that supports Windows 7); CI tests 3.8.

## Honest limits — read before promising "100% Windows 7"
- **Not tested on a real Windows 7 machine or old CPU/GPU by the author.** The branch is designed for them; it is not verified.
- Chromium/Electron 18 needs at least an SSE3-capable x86 CPU (roughly 2005+). Older CPUs will not start it; no setting fixes that.
- Windows 7 needs SP1 and current updates (incl. the Universal C Runtime, KB2999226).
- **Security:** Electron 18 / Chromium 100 no longer receive security fixes. Keep Workspace Trust on, do not open untrusted
  web content, prefer an offline machine. Use the `main` line wherever Windows 10+ is available.
- Extensions must declare `engines.vscode <= 1.70`; many current extensions will not install or run.
- Use a Git for Windows release that still supports Windows 7 (check its release notes).
- The build workflow follows upstream's own 1.70 steps but **has not been run**; MSVC/node-gyp on current runners may need fixes.
