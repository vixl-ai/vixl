---
title: Managed components
description: Language servers and CodeGraph that Vixl downloads or runs for you, including storage and how to turn them off.
---

# Managed components

Vixl downloads a catalog of language servers, and runs [CodeGraph](https://www.npmjs.com/package/@colbymchenry/codegraph) via npx. PATH-only catalog rows are not downloaded. Project-local linters have no managed installer. How to use language servers in the editor: [Language servers](/customize/language-servers). How the graph is used in chat: [Code graphs](/concepts/code-graphs).

## CodeGraph

Package: `@colbymchenry/codegraph` (unpinned; npx fetches current).

When you activate a project, Vixl starts CodeGraph for that root. If `codegraph.db` is missing it runs `npx -y @colbymchenry/codegraph init`. Rebuild from the Graph tab runs `index --force`. The MCP server is `npx -y @colbymchenry/codegraph serve --mcp --path {root}`. Indexes live under personal `.vixl/graphs/{sha256}/` (`codegraph.db`, `meta.json`, `_preload.cjs`), never in the repo. The folder name is the SHA-256 hex of the canonical absolute project root.

Vixl sets `CODEGRAPH_TELEMETRY=0` so the package's own telemetry is off. It also sets `CODEGRAPH_NO_UPDATE_CHECK=1`. This is the only telemetry-related string in the app. See [Privacy](/resources/privacy).

There is no `settings.json` key to disable CodeGraph. It starts again the next time you activate the project. You can delete a stored index from Settings > Graphs (the next activate runs `init` again). Stop from the chat graph chip lasts until the next activate. A user `codegraph` entry in `mcp.json` is stripped.

## Language servers Vixl installs

Installs go under personal `~/.vixl/lsp/{id}/{version}/`. npm servers also use a portable Node at `~/.vixl/runtime/node/`. State (enabled, disabled, command overrides) is personal `lsp.json`.

When you activate a project, Vixl prefetches the default set (TypeScript / JavaScript, JSON, YAML, Markdown) if auto-download is on. Settings > LSP, **Install defaults** does the same.

Install kinds: npm package, GitHub release (repo / tag / asset), HTTP archive, or `go install`.

### npm

| Id | Packages | npm |
| --- | --- | --- |
| `typescript` | `typescript@7.0.2` | [typescript](https://www.npmjs.com/package/typescript) |
| `typescript-classic` | `typescript-language-server@5.3.0`, `typescript@5.8.2` | [typescript-language-server](https://www.npmjs.com/package/typescript-language-server) |
| `json` | `vscode-langservers-extracted@4.10.0` | [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) |
| `yaml` | `yaml-language-server@1.17.0` | [yaml-language-server](https://www.npmjs.com/package/yaml-language-server) |
| `vue` | `@vue/language-server@3.3.9`, `@vue/typescript-plugin@3.3.9`, `typescript@5.8.2` | [@vue/language-server](https://www.npmjs.com/package/@vue/language-server) |
| `python` | `pyright@1.1.414` | [pyright](https://www.npmjs.com/package/pyright) |
| `bash` | `bash-language-server@5.4.3` | [bash-language-server](https://www.npmjs.com/package/bash-language-server) |
| `html` | `vscode-langservers-extracted@4.10.0` | [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) |
| `css` | `vscode-langservers-extracted@4.10.0` | [vscode-langservers-extracted](https://www.npmjs.com/package/vscode-langservers-extracted) |
| `tailwindcss` | `@tailwindcss/language-server@0.0.27` | [@tailwindcss/language-server](https://www.npmjs.com/package/@tailwindcss/language-server) |
| `svelte` | `svelte-language-server@0.17.10` | [svelte-language-server](https://www.npmjs.com/package/svelte-language-server) |
| `astro` | `@astrojs/language-server@2.15.4` | [@astrojs/language-server](https://www.npmjs.com/package/@astrojs/language-server) |
| `prisma` | `@prisma/language-server@6.5.0` | [@prisma/language-server](https://www.npmjs.com/package/@prisma/language-server) |
| `graphql` | `graphql-language-service-cli@3.5.0` | [graphql-language-service-cli](https://www.npmjs.com/package/graphql-language-service-cli) |
| `dockerfile` | `dockerfile-language-server-nodejs@0.13.0` | [dockerfile-language-server-nodejs](https://www.npmjs.com/package/dockerfile-language-server-nodejs) |
| `php` | `intelephense@1.14.4` | [intelephense](https://www.npmjs.com/package/intelephense) |

`typescript-classic` is the Vue LS 3 hybrid install source. It is not a separate catalog row you disable. It is spawned as id `typescript`.

### GitHub releases

| Id | Repo | Tag | Asset |
| --- | --- | --- | --- |
| `markdown` | [artempyanykh/marksman](https://github.com/artempyanykh/marksman/releases/tag/2024-12-18) | `2024-12-18` | `marksman-{target}` |
| `rust` | [rust-lang/rust-analyzer](https://github.com/rust-lang/rust-analyzer/releases/tag/2025-03-10) | `2025-03-10` | `rust-analyzer-{target}.gz` |
| `lua` | [LuaLS/lua-language-server](https://github.com/LuaLS/lua-language-server/releases/tag/3.13.6) | `3.13.6` | `lua-language-server-{version}-{target}.tar.gz` |
| `clangd` | [clangd/clangd](https://github.com/clangd/clangd/releases/tag/19.1.2) | `19.1.2` | `clangd-{target}-{version}.zip` |
| `toml` | [tamasfe/taplo](https://github.com/tamasfe/taplo/releases/tag/0.9.3) | `0.9.3` | `taplo-full-{target}.gz` |
| `zig` | [zigtools/zls](https://github.com/zigtools/zls/releases/tag/0.13.0) | `0.13.0` | `zls-{target}.tar.xz` |
| `kotlin` | [fwcd/kotlin-language-server](https://github.com/fwcd/kotlin-language-server/releases/tag/1.3.13) | `1.3.13` | `server.zip` |
| `xml` | [redhat-developer/vscode-xml](https://github.com/redhat-developer/vscode-xml/releases/tag/0.29.0) | `0.29.0` | `lemminx-{target}.zip` |
| `sql` | [supabase-community/postgres-language-server](https://github.com/supabase-community/postgres-language-server/releases/tag/0.25.7) | `0.25.7` | `postgres-language-server_{target}` |
| `clojure` | [clojure-lsp/clojure-lsp](https://github.com/clojure-lsp/clojure-lsp/releases/tag/2026.07.06-14.34.19) | `2026.07.06-14.34.19` | `clojure-lsp-native-{target}.zip` |

`{target}` is a platform token (Rust triple, OS name, or similar, per server). `{version}` is the tag without extra prefix when the asset template includes it.

### HTTP archives

| Id | Source |
| --- | --- |
| `terraform` | [HashiCorp terraform-ls 0.36.4](https://releases.hashicorp.com/terraform-ls/0.36.4/) (`terraform-ls_{version}_{target}.zip`) |
| `java` | [Eclipse JDT Language Server](https://download.eclipse.org/jdtls/snapshots/jdt-language-server-latest.tar.gz) snapshot `jdt-language-server-latest.tar.gz`. Needs a JDK on PATH. |

### Go

| Id | Package |
| --- | --- |
| `gopls` | [`golang.org/x/tools/gopls@v0.18.1`](https://pkg.go.dev/golang.org/x/tools/gopls@v0.18.1) via `go install` (Go must be on PATH) |

## PATH-only (not downloaded)

These catalog rows use a binary already on PATH: `deno`, `ruby`, `csharp`, `swift`, `elixir`, `haskell`, `ocaml`, `dart`, `gleam`, `nix`, `r`, `scala`.

Project-local linters `eslint`, `oxlint`, and `biome` have no managed installer. They require workspace trust. See [settings.json](/reference/settings-json) (`workspace.trust`).

## Turn language servers off

- Settings > LSP: turn off **Auto-download** (`lsp.autoDownload`, personal). Prefetch on project activate becomes a no-op.
- Environment: `VIXL_DISABLE_LSP_DOWNLOAD` set to `1`, `true`, `TRUE`, or `yes` also skips prefetch, even if the setting is on.
- Settings > LSP, or `lsp.json`: disable individual servers. `lsp.json` set to `false` disables all of them.
- Uninstall a managed install from the LSP row. Files remain under `.vixl/lsp/` until removed.

`lsp.*` cannot be overridden by a project `settings.json`.
