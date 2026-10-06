---
title: Custom agent frontmatter
description: YAML frontmatter fields for custom agents in .vixl/agents, plus file locations and name rules.
---

# Custom agent frontmatter

Custom agents are markdown files that spawn as sub-agents. Create them from Settings or the project Agents tab. Run them with `/` in the chat input. How-to: [Custom agents](/customize/custom-agents).

## Locations and names

| Scope | Path |
| --- | --- |
| Personal | `~/.vixl/agents/{slug}.md` |
| Project | `<repo>/.vixl/agents/{slug}.md` |

The id is the filename stem (`reviewer.md` is `reviewer`). Creating from the UI slugifies the name (lowercase, hyphens). Project agents overlay personal agents with the same name (case-insensitive). Home chats, and a workspace rooted at your user home directory, see personal agents only.

Reserved slash names `ask`, `plan`, `agent`, and `orchestrator` are [chat modes](/concepts/chat-modes), not custom agents. Those names are hidden from `/`. Spawn still accepts any other `agentName`: if it matches a catalog agent, that definition is used; otherwise it is a generic helper labeled with that name.

The repo's `.vixl/agents/bugfinder.md` is a real project agent you can copy.

## Document shape

Vixl parses YAML between the first pair of `---` lines as frontmatter. The rest is the agent body, which becomes the sub-agent system prompt. Missing or invalid frontmatter loads as empty.

```markdown
---
name: "bugfinder"
description: "Review the diff vs HEAD for bugs and inconsistencies"
model: "anthropic::claude-sonnet-4-5"
reasoning: high
tools: ["read_file", "grep", "glob_files", "git_diff", "git_status", "lsp"]
---

Review uncommitted changes against HEAD. Report defects. Do not fix code or commit.
```

## Fields

All frontmatter fields are optional.

| Field | Type | Default when omitted | Effect |
| --- | --- | --- | --- |
| `name` | string, min length 1 | Filename stem | Catalog label and `/` name |
| `description` | string, min length 1 | `name`, else the filename stem | Shown in `/` and in `Available subagents` |
| `model` | string, min length 1 | Unset | Model ref `providerId::modelId` used on spawn unless a call `model` or an Orchestrate lock is set |
| `reasoning` | reasoning level | Unset | Reasoning for that spawn. Invalid values are dropped |
| `tools` | string array | Unset | Intersects the spawn allowlist. Absent keeps the full read-only or write set for that spawn |

`reasoning` must be one of: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`.

`tools` may be a JSON array (`["read_file", "grep"]`) or a comma-separated string (`read_file, grep`). Names that are not on the spawn allowlist are dropped.

A `/agent` mention does not dump the body into the parent prompt. The parent is told to call `spawn_subagent` with that catalog name.

## Spawn allowlist

Default spawn capabilities are `read-only`. Ask and Plan cannot spawn `write` sub-agents. Nested agents get a subset of harness tools. Optional `tools` intersect that nested allowlist; names that are not on it are dropped. The nested tool lists are on [Chat modes](/concepts/chat-modes#nested-sub-agents).

If the chat has a locked sub-agent model (Orchestrate), spawn ignores both the call `model` and this file's `model`.
