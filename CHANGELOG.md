# Changelog

## 1.0.0
- Fork of Code - OSS with NX branding, Open VSX gallery, telemetry/update defaults off.
- Built-in extension **NX Studio**: Pipeline Lab (CI/CD), Task Graph, Test Intelligence, Release Pilot, Git Command Center,
  Code Review, Dependency Guardian, Project Forge, Log Explorer, Profiler, Live Preview, Claude Ask + Project Agent,
  Studio Profiles, plus new CI Doctor, Secret Scanner, Compatibility Doctor, Safe Graphics Mode.
- Two branches: `main` (current upstream VS Code) and `LEGACY` (the same source plus a compatibility layer targeting Electron 22.3.27 for Windows 7+ / old hardware; port in progress, see docs/LEGACY.md).

### LEGACY compatibility layer (latest VS Code source on Electron 22.3.27)
- CommonJS node-side bundles, ES2022/chrome108 targets, polyfills, fetch/Request/Response, `protocol.handle`/`net.fetch` shims, `color-mix()` CSS fallbacks. Not yet built or booted; see `docs/LEGACY.md`.
