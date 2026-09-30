---
title: Context
description: Each Vixl turn builds a small system prompt from catalogs and names, then loads full MCP schemas and skill bodies on demand.
---

# Context

Each turn builds a small system prompt, then adds only what this chat needs. Catalogs and names go in first. Full MCP schemas and skill bodies load when the agent asks. That is why local prefills stay smaller than harnesses that dump every tool schema up front.

The prompt always includes a short workspace identity (project name and root; workspace tools stay on this repo), shared tool guidance, and the built-in skill for the current [chat mode](/concepts/chat-modes). What else is injected depends on the chat.

## Mentions

`@` searches workspace files. Home chats and a composer still on **No project** have no workspace for that search. A file mention is stored as a path and tagged untrusted context: data, not instructions.

`/` lists vendored command skills, user and project skills, and custom agents. Reserved names `ask`, `plan`, `agent`, and `orchestrator` stay hidden. A skill mention becomes a name in the prompt. The agent loads the body with `load_skill`. An agent mention does not dump instructions. It adds an explicit invocation: the parent must call `spawn_subagent` with that catalog name. Unresolved agent names are dropped.

On a home chat, `/` lists vendored command skills, personal skills and agents, and skills and agents under that home workspace `.vixl`. A same-named user or project skill cannot override a vendored command. On a project chat, personal plus project, and the project name wins over personal.

## Rules and AGENTS.md

These are always-on for the chats that inject them. There is no per-rule glob gate. Every listed rule file is included.

Project chats inject project `.vixl/AGENTS.md` (or `agents.md`) and concatenate project `.vixl/rules/*.{md,mdc}`. They do not fall back to personal `AGENTS.md`, and they do not merge personal rules.

Home chats inject personal `.vixl/AGENTS.md` only. They do not inject `.vixl/rules`. A rule file written on the home path is not injected. Always-on home guidance is personal `AGENTS.md`. Personal rules still exist in Settings. They are not injected into project chats either.

Unreadable files and paths outside the read root are stubbed in the prompt, not silently dropped.

Edit these in [Rules and AGENTS.md](/customize/rules-and-agents-md).

## Skills

Skills are `SKILL.md` packs under `.vixl/skills/<name>/`. `/create-agent`, `/create-skill`, `/create-rule`, and `/create-plan` are vendored command skills. They are listed in `/` and in Available skills. They work on home chats. The workspace root is the user home directory, and the agent writes the same relative `.vixl/` paths there. Mode skills `ask`, `plan`, `agent`, and `orchestrator` stay hidden from `/` and stay inlined only in their matching chat mode.

On a project chat, Available skills lists remaining skills as names and descriptions (vendored commands, then personal, then project overlay). On a home chat, Available skills lists vendored commands and home-workspace skills. It does not add personal skills, even though `/` on a home chat does.

`load_skill` loads the body by name (built-in, then project, then personal; bodies over 4000 characters are truncated). The full rules are on [SKILL.md format](/reference/skill-md-format). See also [Skills](/customize/skills).

## Progressive tool discovery

The MCP catalog in the prompt is enabled user servers (not CodeGraph), status, and tool names with descriptions cut at 200 characters. Full `inputSchema` is not dumped up front. The agent calls `get_mcp_tools` (optional `serverId` for one server's schemas) or `get_mcp_tool` for a single tool, then `call_mcp_tool`. Untrusted catalog data is labeled as such.

The same pattern applies to skills: names in the prompt, bodies on `load_skill`.

Sub-agents appear as an available-subagents catalog from `.vixl/agents/*.md`. On a home chat that catalog is personal agents only. See [Custom agents](/customize/custom-agents).

Long threads can drop older turns behind a compact summary. That is a chat operation, not a model role. [Compact and hand off long chats](/using/compact-and-hand-off-long-chats) is how you run it.
