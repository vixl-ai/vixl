---
title: Language servers
description: Language servers drive hover and completion in the Vixl workbench; Settings > LSP is personal and requires the desktop app.
---

# Language servers

Language servers drive hover and completion in the workbench editor. Settings > LSP is personal: install and disable state in `{appData}/.vixl/lsp.json`, auto-download in `settings.json` (`lsp.autoDownload`, default on). Project folders cannot override `lsp.*`. Language servers require the desktop app.

Header **Install defaults** starts the Tier A set (TypeScript / JavaScript, JSON, YAML, Markdown). The same prefetch runs when a project is activated. Auto-download: download default language support on project open. Disable for airgapped machines.

Per row: enable/disable (Play / Ban), Install when missing, Retry on error, Uninstall when `source` is `managed`. Status badges include Disabled, Requires workspace trust, Running, Managed install, Available on PATH, Not installed, Needs toolchain on PATH, and live install states. Events: `lsp://install`.

Project-local servers that require trust ([ESLint](https://eslint.org), [Oxlint](https://oxc.rs), [Biome](https://biomejs.dev)) need `workspace.trust` for the active project. Vue / Nuxt hybrid installs [typescript-language-server](https://www.npmjs.com/package/typescript-language-server) `5.3.0` plus [typescript](https://www.npmjs.com/package/typescript) `5.8.2` as `typescript-classic`, which appears in Settings > LSP as TypeScript (Vue / Nuxt Hybrid), an install-only row with no disable toggle.

Every installable server below is what Vixl actually fetches. Toolchain rows are listed after that: they are in the catalog but Vixl does not download them. Duplicate listing with sources: [Managed components](/reference/managed-components).

## Installable servers

npm:

- TypeScript / JavaScript (`typescript`): [typescript](https://www.npmjs.com/package/typescript) `7.0.2` (native bin)
- JSON (`json`): [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) `4.10.0`
- YAML (`yaml`): [yaml-language-server](https://www.npmjs.com/package/yaml-language-server) `1.17.0`
- Vue / Nuxt (`vue`): [@vue/language-server](https://www.npmjs.com/package/@vue/language-server) `3.3.9`, [@vue/typescript-plugin](https://www.npmjs.com/package/@vue/typescript-plugin) `3.3.9`, [typescript](https://www.npmjs.com/package/typescript) `5.8.2` ([Vue](https://vuejs.org))
- Python (`python`): [pyright](https://www.npmjs.com/package/pyright) `1.1.414`
- Bash (`bash`): [bash-language-server](https://www.npmjs.com/package/bash-language-server) `5.4.3`
- HTML (`html`): [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) `4.10.0`
- CSS (`css`): [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) `4.10.0`
- Tailwind CSS (`tailwindcss`): [@tailwindcss/language-server](https://www.npmjs.com/package/@tailwindcss/language-server) `0.0.27`
- Svelte (`svelte`): [svelte-language-server](https://www.npmjs.com/package/svelte-language-server) `0.17.10`
- Astro (`astro`): [@astrojs/language-server](https://www.npmjs.com/package/@astrojs/language-server) `2.15.4`
- Prisma (`prisma`): [@prisma/language-server](https://www.npmjs.com/package/@prisma/language-server) `6.5.0`
- GraphQL (`graphql`): [graphql-language-service-cli](https://www.npmjs.com/package/graphql-language-service-cli) `3.5.0`
- Dockerfile (`dockerfile`): [dockerfile-language-server-nodejs](https://www.npmjs.com/package/dockerfile-language-server-nodejs) `0.13.0`
- PHP (`php`): [intelephense](https://www.npmjs.com/package/intelephense) `1.14.4`

GitHub Releases (repo, tag, asset template):

- Markdown (`markdown`): [artempyanykh/marksman](https://github.com/artempyanykh/marksman) tag `2024-12-18`, asset `marksman-{target}` ([marksman](https://github.com/artempyanykh/marksman))
- Rust (`rust`): [rust-lang/rust-analyzer](https://github.com/rust-lang/rust-analyzer) tag `2025-03-10`, asset `rust-analyzer-{target}.gz`
- Lua (`lua`): [LuaLS/lua-language-server](https://github.com/LuaLS/lua-language-server) tag `3.13.6`, asset `lua-language-server-{version}-{target}.tar.gz`
- C / C++ (`clangd`): [clangd/clangd](https://github.com/clangd/clangd) tag `19.1.2`, asset `clangd-{target}-{version}.zip`
- TOML (`toml`): [tamasfe/taplo](https://github.com/tamasfe/taplo) tag `0.9.3`, asset `taplo-full-{target}.gz`
- Zig (`zig`): [zigtools/zls](https://github.com/zigtools/zls) tag `0.13.0`, asset `zls-{target}.tar.xz`
- Kotlin (`kotlin`): [fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server) tag `1.3.13`, asset `server.zip`
- XML (`xml`): [redhat-developer/vscode-xml](https://github.com/redhat-developer/vscode-xml) tag `0.29.0`, asset `lemminx-{target}.zip`
- Postgres (`sql`): [supabase-community/postgres-language-server](https://github.com/supabase-community/postgres-language-server) tag `0.25.7`, asset `postgres-language-server_{target}`
- Clojure (`clojure`): [clojure-lsp/clojure-lsp](https://github.com/clojure-lsp/clojure-lsp) tag `2026.07.06-14.34.19`, asset `clojure-lsp-native-{target}.zip`

Go install:

- Go (`gopls`): [`golang.org/x/tools/gopls@v0.18.1`](https://pkg.go.dev/golang.org/x/tools/gopls) (needs Go on PATH)

HTTP archives:

- Terraform (`terraform`): [terraform-ls 0.36.4](https://releases.hashicorp.com/terraform-ls/0.36.4/) from `https://releases.hashicorp.com/terraform-ls/{version}/terraform-ls_{version}_{target}.zip` ([hashicorp/terraform-ls](https://github.com/hashicorp/terraform-ls))
- Java (`java`): Eclipse JDT LS snapshot from [download.eclipse.org](https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz) (`jdt-language-server-latest.tar.gz`)

TypeScript (Vue / Nuxt Hybrid) (`typescript-classic`): visible install-only row in Settings > LSP with no disable toggle. [typescript-language-server](https://www.npmjs.com/package/typescript-language-server) `5.3.0` and [typescript](https://www.npmjs.com/package/typescript) `5.8.2`.

## Toolchain on PATH (not downloaded)

These catalog rows use a binary already on PATH. Badge: Needs toolchain on PATH, or Available on PATH when found.

- [Deno](https://deno.land) (`deno lsp`)
- [Ruby](https://github.com/Shopify/ruby-lsp) (`ruby-lsp`)
- [csharp-ls](https://github.com/razzmatazz/csharp-language-server) (`csharp-ls`)
- [Swift](https://github.com/swiftlang/sourcekit-lsp) (`sourcekit-lsp`)
- [Elixir](https://github.com/elixir-lsp/elixir-ls) (`elixir-ls`)
- [Haskell](https://github.com/haskell/haskell-language-server) (`haskell-language-server-wrapper --lsp`)
- [OCaml](https://github.com/ocaml/ocaml-lsp) (`ocamllsp`)
- [Dart](https://dart.dev) (`dart language-server --protocol=lsp`)
- [Gleam](https://gleam.run) (`gleam lsp`)
- [Nix](https://github.com/oxalica/nil) (`nil`)
- [R](https://github.com/REditorSupport/languageserver) (`R --slave -e languageserver::run()`)
- [Scala](https://scalameta.org/metals/) (`metals`)

## Trust-required project-local

[ESLint](https://eslint.org), [Oxlint](https://oxc.rs), and [Biome](https://biomejs.dev) are in the catalog with no managed install. They require workspace trust. Badge: Requires workspace trust.

See [Use the workbench](/using/use-the-workbench) and [Managed components](/reference/managed-components).
