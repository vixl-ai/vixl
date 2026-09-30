---
title: The .vixl directory
description: Vixl keeps personal and project .vixl trees for config, while API keys and MCP secrets stay in the OS keychain.
---

# The .vixl directory

Vixl keeps two config trees. API keys and [MCP](https://modelcontextprotocol.io/) secrets are in the OS keychain, not in either tree. See [Providers](/customize/providers) for the keychain. The exhaustive path list is on [.vixl layout](/reference/vixl-layout). This page is the split and the merge.

## Personal vs project

Personal `.vixl` is under the app data directory ([Tauri](https://tauri.app)'s `app_data_dir` for identifier `app.vixl`). On macOS that is `~/Library/Application Support/app.vixl/.vixl`. The directory is created if missing. Chats, the fleet registry, graph stores, and personal settings live here.

Project `.vixl` is resolved from the opened folder:

1. Keep `{root}/.vixl` when that directory exists (even skills-only, with no `settings.json`).
2. Walk up to 8 parent folders, stopping at your home directory (and never selecting `{home}/.vixl`).
3. Fall back to `{root}/.vixl` if no ancestor `.vixl` is found (it may not exist yet).

Vixl treats a resolved `.vixl` as having project config when it contains `mcp.json` or `settings.json`. A skills-only `.vixl` still resolves as the project directory. JSON writes are allowed under personal `.vixl` or any path with a `.vixl` ancestor.

Adding a project does not create `<repo>/.vixl`. It appears when config is first written. The project tree is committable.

## What each tree is for

Personal holds settings, MCP, LSP state, SQLite, the fleet, graph indexes, per-chat files, and personal copies of agents, skills, plans, rules, and `AGENTS.md`. Home chats use personal `AGENTS.md`. Personal rules are editable in Settings and are not injected into any chat. See [Context](/concepts/context).

Project holds overrides and project MCP servers, plus project-scoped agents, skills, plans, rules, and `AGENTS.md`. Plans from `create_plan` write `.vixl/plans/<id>/PLAN.md`. Skills are `.vixl/skills/<name>/SKILL.md`. Custom agents are `.vixl/agents/<slug>.md`. Rules are flat `.md` or `.mdc`. `AGENTS.md` sits in the `.vixl` root, not under `agents/`.

## Merge

Effective settings for a project chat are personal `settings.json` plus project `settings.json`. Invalid project JSON contributes no overrides. Home chats load personal settings only.

Project overlay wins for most keys. Keys starting `providers.`, `models.`, or `lsp.` are personal only. If they appear in a project file they are stripped and rewritten.

`agent.mcp.trust` unions by `serverId`. Scope `never` beats everything. Otherwise the project record wins.

`agent.permissions` unions by `capability`. Personal `deny` wins. Then project `deny`. Else project.

`agent.autoApproveGlobs` is the union of both string lists.

MCP servers: project `servers[id]` replaces personal `servers[id]`. Inputs merge by id (project wins). The managed CodeGraph id `codegraph` is stripped from user lists.

Skills and custom agents: same name, project wins (case-insensitive). Skill load-by-name is on [SKILL.md format](/reference/skill-md-format).

Rules and `AGENTS.md` are not a name-merge. Project chats inject project files only. Home chats inject personal `AGENTS.md` and no rules.

[settings.json](/reference/settings-json) is the field-level reference. [Customize](/customize/providers) is where you edit these files from the UI.
