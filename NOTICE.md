# NOTICE

NX Studio Code is a fork of the MIT-licensed **Code - OSS** (`microsoft/vscode`). It is **not** a Microsoft product and is
not affiliated with or endorsed by Microsoft. "Visual Studio Code" is a trademark of Microsoft.

- Upstream license: `LICENSE.txt` (MIT) is kept unchanged. NX additions (`extensions/nx-studio`, `nx/`, workflows, docs) © Barman, MIT.
- Extensions come from **Open VSX**, not the Microsoft Marketplace (its terms do not allow other products to use it).
  Upstream's `builtInExtensions` list (Marketplace downloads, incl. the JS debugger) was removed from `product.json`; install a JS debugger
  or other extras from Open VSX. Upstream's chat/Copilot code paths remain in the `main` workbench (parts of it read `product.json` keys without null checks);
  the Copilot extension itself is not available from Open VSX, so those features stay inactive.
- Icons/logos are still the Code - OSS defaults in `resources/`; replace them with your own artwork before public release.
- Vendored: PyYAML 6.0.2 (MIT) in `extensions/nx-studio/python/nxcs/_vendor/yaml`.
- GitHub repository names allow only ASCII letters, digits, `-`, `_`, `.`; the name "NX Studio Coďe" will be normalised by GitHub
  (spaces and non-ASCII characters become `-`). The product name itself is "NX Studio Code".
