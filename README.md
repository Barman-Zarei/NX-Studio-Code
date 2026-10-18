# NX Studio Code

**Version 1.0.0** · by **Barman** · https://github.com/Barman-Zarei/NX-Studio-Code

A fork of Code - OSS (the open-source core of VS Code) that carries the features of **NX Code Studio** as a built-in
extension — CI/CD (Pipeline Lab, Task Graph, CI Doctor), Test Intelligence, Release Pilot, Git Command Center, code review,
secret scanner, Claude Ask/Project Agent, project forge, profiler, live preview and more — plus tools for weak or old hardware.

## Branches

| Branch | Engine | Targets |
|---|---|---|
| `main` | current upstream VS Code (1.143.0 at import, Electron 43) | Windows 10+, Linux, macOS |
| `LEGACY` | same source as `main`, retargeted to Electron 22.3.27 (port in progress) | **Windows 7 SP1+**, 32-bit and 64-bit, old CPUs and graphics cards |

Both branches carry the **same NX layer** (same extension, branding, defaults, docs and CI). They differ only in the VS Code
Electron target and a small compatibility layer, because Electron 23+ cannot run on Windows 7. `git diff main LEGACY` shows all of it; see `docs/LEGACY.md` for the **current, unfinished status**.

## What is included
See `docs/NX-FEATURES.md` for the full table with honest status. Open the command menu by clicking **NX 1.0.0** in the status bar
or run `NX: Command Menu`.

## Build / test
See `docs/BUILDING.md`. Quick check of the NX layer without a full build:
```
cd extensions/nx-studio/python && python -m unittest discover -s tests -v
node extensions/nx-studio/test/smoke.js
```

## Honest status
- NX layer: automated tests (Python core + extension smoke test with a fake VS Code API). **Never run inside a real built editor yet.**
- Full editor builds (`.github/workflows/build.yml`): written from upstream pipelines, **not yet executed**.
- Claude features: code paths tested with a mock transport only; **no live API call has been verified**.
- Licenses and third-party notes: `NOTICE.md`.

## خلاصه فارسی
ادیتور NX Studio Code یک فورک از Code - OSS است و ویژگی‌های NX Code Studio (از جمله CI/CD، تست، ریلیز، گیت، بررسی کد، اسکنر
رمز/کلید، Claude) به‌صورت اکستنشن داخلی در آن قرار دارد. شاخه‌ی `main` روی جدیدترین VS Code است و شاخه‌ی `LEGACY` همان سورس با Electron 22 و لایه‌ی سازگاری (در حال تکمیل)
برای ویندوز ۷ و سخت‌افزار قدیمی. بیلد کامل هنوز اجرا نشده و روی ویندوز ۷ واقعی تست نشده است.
