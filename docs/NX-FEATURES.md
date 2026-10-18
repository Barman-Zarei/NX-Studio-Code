# NX Studio Code 1.0.0 — features and honest status

Legend: **PORTED** = available as an NX command in this editor · **NATIVE** = VS Code already does it, so the Qt
version was not re-implemented · **NOT DONE** = not implemented. "Tested" means automated tests exist in this repo
(`extensions/nx-studio/python/tests`, `extensions/nx-studio/test/smoke.js`).

| NX Code Studio module | Here | Command / note |
|---|---|---|
| 7.1 IDE Core | NATIVE | tabs, explorer, terminal, search, palette, split view, themes, folding, highlighting, LSP — all VS Code |
| 7.2 Claude API | PORTED | `NX: Claude: Set API Key` (OS keychain), `NX: Claude: Ask`. **Live API call not tested** (no key in CI) |
| 7.3 Debugger | NATIVE | VS Code debugging (DAP) supersedes the bdb prototype; prototype stays in the core, no command |
| 7.4 Pipeline Lab (CI/CD) | PORTED, tested | `NX: Pipeline Lab: Run Workflow Locally / Inspect`. Runs `run:` steps only; `uses:`, matrix, services, secrets, `${{ }}` are **reported as not executed** |
| 7.5 Project Intelligence | PORTED, tested | `NX: Analyze Project` + sidebar view |
| 7.6 Code Review | PORTED, tested | `NX: Review Current File` → Problems panel (confirmed static findings). AI review not exposed |
| 7.7 Test Intelligence | PORTED | `NX: Run Tests` (unittest) → failures in Problems panel |
| 7.8 Git Command Center | PORTED, tested | `NX: Git Command Center`; destructive actions need modal confirmation. (VS Code's own Git/SCM also available) |
| 7.9 Dependency Guardian | PORTED | `NX: Dependency Guardian` (pip, needs network; advisories **unavailable**) |
| 7.10 Task Graph | PORTED, tested | `NX: Task Graph: Run .nx/tasks.json` (DAG, concurrency, skip-on-failure, cycle detection) |
| 7.11 Release Pilot | PORTED | `NX: Release Pilot` — bump, changelog, checklist. Never tags/pushes/publishes |
| 7.12 Language Engine / 7.13 Extension Hub | NATIVE | LSP + extensions via Open VSX |
| 7.14 Live Preview | PORTED | `NX: Live Preview` — static server on 127.0.0.1 only |
| 7.15 Safe Run | PORTED | used by pipelines/tasks (`nx.restrictedRun`). **Not a sandbox** |
| 7.16 Project Agent | PORTED, tested (core) | `NX: Claude: Project Agent` — draft → VS Code diff → modal approval → conflict-safe apply |
| 7.17 Profiler | PORTED | `NX: Profile Current Python Script` |
| 7.18/7.21 Studio & Environment Profiles | PORTED (reworked) | `NX: Apply Studio Profile` writes **real VS Code settings** (python, web, cpp, low-resource, legacy-safe, offline) |
| 7.19 Patch Review | PARTIAL | agent flow uses VS Code diff + conflict-safe apply; per-hunk selection exists in the core (`patch.hunks`) but has no UI |
| 7.22 Project Forge | PORTED, tested | `NX: Project Forge: New Project` (python/cli/web/c) |
| 7.23 Change Preview | PARTIAL | upgrade-risk preview inside Dependency Guardian |
| 7.26 Log Explorer | PORTED | `NX: Log Explorer: Filter / Sanitize Current File` |
| 7.20 GitHub Bridge, 7.24 Offline Library, 7.25 Repository Manager | NOT DONE | were never implemented in NX Code Studio either |

## New in NX Studio Code (not in the Qt editor)

| Feature | Command | Honest scope |
|---|---|---|
| **CI Doctor** | `NX: CI Doctor: Lint Workflows` | unpinned actions, missing `permissions`, `pull_request_target` + PR checkout, `${{ github.event… }}` script injection, missing timeouts. Static only |
| **Secret Scanner** | `NX: Scan Workspace for Secrets` | regex heuristics (AWS, GitHub, Anthropic, Slack, JWT, private keys, generic). Findings masked. Candidates, not proof |
| **Compatibility Doctor** | `NX: Compatibility Doctor` | OS/RAM/CPU-threads/Python report + recommended profile. Cannot read GPU model or SSE/AVX flags |
| **Safe Graphics Mode** | `NX: Safe Graphics Mode` | toggles `disable-hardware-acceleration` in `~/.nx-studio-code/argv.json` (restart needed) |
| **Command menu / status bar** | click `NX 1.0.0` | one list of every NX command |
| Offline defaults | profile `offline` | telemetry off, no update checks, no auto-fetch |

The Python core (`extensions/nx-studio/python/nxcs`, stdlib only, Python 3.8+) needs a Python on the machine
(`nx.pythonPath` or auto-detect). PyYAML is vendored as a pure-Python fallback.
