---
title: ".vixl layout"
description: Every file and folder in personal and project .vixl trees, with paths and commit guidance.
---

# .vixl layout

Vixl keeps two config trees: personal `~/.vixl` and project `<repo>/.vixl`. API keys are in the OS keychain, not in either tree. Merge rules: [The .vixl directory](/concepts/the-vixl-directory).

## Personal directory

Personal config is `~/.vixl` on every platform (on Windows, `%USERPROFILE%\.vixl`), created if missing.

Do not commit this tree. It is machine-local.

| Path | What | Commit |
| --- | --- | --- |
| `settings.json` | Theme, models, provider refs, permissions, MCP trust, sandbox, auto-title, workbench duplicate-tab, workspace trust, LSP auto-download. See [settings.json](/reference/settings-json) | No |
| `mcp.json` | Personal MCP servers. See [mcp.json](/reference/mcp-json) | No |
| `lsp.json` | Language server enable, disable, and command overrides (personal only) | No |
| `lsp/<id>/<version>/` | Managed language server installs | No |
| `runtime/node/` | Portable Node used to run npm language servers | No |
| `vixl.sqlite` | Chats, messages, usage, pins, workbench tabs and prefs, editor view state | No |
| `chats/<projectSlug>/<chatId>/` | Per-chat directory. File checkpoints live under `file-checkpoints/` | No |
| `projects.json` | Fleet registry | No |
| `active-project.json` | Last active project id | No |
| `graphs/<sha256>/` | Per-project CodeGraph store (`codegraph.db`, `meta.json`, `_preload.cjs`). The folder name is the SHA-256 hex of the canonical project root | No |
| `agents/` | Personal custom agents (`{slug}.md`) | No |
| `skills/` | Personal skills (`{slug}/SKILL.md`) | No |
| `plans/` | Personal plans (`{id}/PLAN.md`). Frontmatter: [Work with plans](/using/work-with-plans) | No |
| `rules/` | Personal rules, injected on home chats and before project rules on project chats. `.md` or `.mdc` | No |
| `AGENTS.md` | Personal always-on instructions. Injected on home chats, and first on project chats (`agents.md` is accepted if uppercase is missing) | No |

Home chats use slug `_home_` and the user home directory as workspace. Chat files for those threads are under `chats/_home_/<chatId>/`. `/create-skill`, `/create-rule`, and `/create-agent` on a home chat write into this personal tree.

A workspace root equal to the user home directory is this same directory. Vixl does not keep a second project tree there: project-scope settings and MCP reads are empty, project-scope writes are refused, project file lists are empty, and that root is not treated as having project config.

JSON writes are allowed only under the personal `.vixl` or any path with a `.vixl` ancestor. Parent `..` is rejected.

## Project directory

Project config is `<repo>/.vixl`. Resolution:

1. If the opened root is the user home directory, resolve `{home}/.vixl` and stop. That path is the personal root, and project scope for it stays empty.
2. Use `{root}/.vixl` if that directory exists (even skills-only, no `settings.json`).
3. Else walk up to 8 parents.
4. Stop at `$HOME` / `%USERPROFILE%`. Do not select `{home}/.vixl` while walking from a folder under home.
5. Fall back to `{root}/.vixl` if no ancestor `.vixl` is found (it may not exist yet).

Adding a project does not create this folder. It appears when config is first written.

Vixl treats a project as having config only when the resolved directory exists and contains `mcp.json` or `settings.json`. A skills-only `.vixl` still resolves as the project dir. The user home directory never counts as having project config.

This tree is meant to be committed. Removing a project from the sidebar drops the fleet row only. It does not delete `<repo>/.vixl`, chats, or graph indexes.

| Path | What | Commit |
| --- | --- | --- |
| `settings.json` | Overrides except `providers.*`, `models.*`, `lsp.*`. Same schema as personal | Yes |
| `mcp.json` | Project MCP servers (same-id override). Use `${input:...}` for secrets; do not put plaintext tokens here | Yes, if it has no secrets |
| `agents/` | Project custom agents (`{slug}.md`) | Yes |
| `skills/` | Project skills (`{slug}/SKILL.md`) | Yes |
| `plans/` | Project plans (`{id}/PLAN.md`). Frontmatter: [Work with plans](/using/work-with-plans) | Yes |
| `rules/` | Project rules, injected after personal rules on project chats. `.md` or `.mdc` | Yes |
| `AGENTS.md` | Project always-on instructions, concatenated after personal `AGENTS.md` on project chats (`agents.md` fallback) | Yes |

Plans from `create_plan` write `.vixl/plans/<id>/PLAN.md`. The id is `{slug}-{YYYY-MM-DD-HHMMSS}`.

## SQLite

`vixl.sqlite` is always under the personal directory. Deleting a chat deletes the chat row (messages, usage, and related rows cascade) and removes `chats/<slug>/<id>/`. See [Privacy](/resources/privacy).

## Secrets that are not in `.vixl`

On Linux without Secret Service, secrets fall back to `secrets-vault.json` in the app config directory (mode `0600`), not inside `.vixl`. macOS and Windows use the OS keychain. Details: [Providers](/customize/providers).

CodeGraph would otherwise write `{project}/.codegraph`. Vixl redirects that onto the personal `graphs/` store and treats an in-repo `.codegraph` folder as leftover. See [Managed components](/reference/managed-components).
