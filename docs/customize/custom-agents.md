---
title: Custom agents
description: A custom agent is a markdown file that names a specialist sub-agent and becomes its system prompt when spawned.
---

# Custom agents

A custom agent is a markdown file under `.vixl/agents/`. Frontmatter names it and can pin a model, reasoning level, and tools. The body is the sub-agent system prompt. Use one when you want a specialist the parent can spawn (a reviewer, a docs writer) instead of a generic helper.

The complete field list is on [Custom agent frontmatter](/reference/custom-agent-frontmatter).

## Create an agent

Type `/create-agent` in the [chat input](/getting-started/your-first-chat) and send. The agent writes `.vixl/agents/{slug}.md`. You can also create one from Settings > Agents (personal) or the project Agents tab.

| Scope | Where you create it | File |
| --- | --- | --- |
| Personal | Settings > Agents | `~/.vixl/agents/{slug}.md` |
| Project | Project Agents tab | `<repo>/.vixl/agents/{slug}.md` |

On a home chat, `/create-agent` writes `~/.vixl/agents/{slug}.md`, the personal tree. Click a row to open the file in the workbench editor.

```markdown
---
name: "bugfinder"
description: "Review the diff vs HEAD for bugs and inconsistencies"
tools: ["read_file", "grep", "glob_files", "git_diff", "git_status"]
---

Review every uncommitted change against HEAD. Report defects. Do not fix code. Do not commit.
```

`name` and `description` identify the agent in `/` and in the catalog. Optional `model` is a `providerId::modelId` ref. Optional `reasoning` is a reasoning level. Optional `tools` is a JSON array or a comma-separated list of harness tool names. Omit `tools` to keep the full spawn allowlist. Invalid `reasoning` values are dropped. Missing name or description falls back to the filename stem. Every field is on [Custom agent frontmatter](/reference/custom-agent-frontmatter).

Reserved names `ask`, `plan`, `agent`, and `orchestrator` are [chat modes](/concepts/chat-modes), not custom agents. They stay hidden from `/`.

## How it takes effect

`/` lists agents next to [skills](/customize/skills). Selecting one inserts an agent mention. That mention does not dump the instructions into the parent prompt. The parent is told to call `spawn_subagent` with `agentName` set to that catalog name.

The catalog also appears as `Available subagents:` in the prompt. On a home chat, that list is personal agents from `~/.vixl`. Project chats merge personal and project; the same name, case-insensitive, uses the project file. A workspace rooted at your user home directory stays personal only.

When `agentName` matches a catalog agent, that definition is used. Any other name spawns a generic helper labeled with that name.

The file body is the sub-agent system prompt. Optional frontmatter `model` is used unless the spawn call or a plan lock overrides it. Optional `tools` intersect the read-only or write allowlist for that spawn ([Chat modes](/concepts/chat-modes#nested-sub-agents)).

Default spawn capabilities are `read-only`. Ask and Plan cannot spawn `write` helpers. How to run and steer them is on [Orchestrate sub-agents](/using/orchestrate-sub-agents).
