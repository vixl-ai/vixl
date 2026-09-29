---
title: Custom agents
description: A Vixl custom agent is markdown under .vixl/agents/; frontmatter constrains a spawn and the body is the sub-agent prompt.
---

# Custom agents

Create agents from Settings > Agents or the project Agents tab with the New agent sheet. A custom agent is a markdown file under `.vixl/agents/`. Frontmatter names it, optional model and tools constrain a spawn, and the body becomes the sub-agent system prompt.

Usage-level example:

```markdown
---
name: "reviewer"
description: "Review diffs for bugs"
model: "anthropic::claude-sonnet-4-5"
reasoning: high
tools: ["read_file", "grep", "git_diff"]
---

Focus on security and missing tests.
```

`tools` may be a JSON array or a comma-separated string. Invalid `reasoning` values are dropped. Missing name falls back to the filename stem. Missing description falls back to name or stem. Full field spec: [Custom agent frontmatter](/reference/custom-agent-frontmatter).

## Personal vs project

- Personal: Settings > Agents. Files: `{appData}/.vixl/agents/{slug}.md`.
- Project: project Agents tab. Files: `<repo>/.vixl/agents/{slug}.md`.

**New agent** opens a sheet: Name, Description, optional Model (catalog row, placeholder "Provider default"), optional Tools, Instructions. Create writes the file. Click a row to open it in the workbench editor.

Tool picker groups: Files, Search, Git, Shell, [MCP](https://modelcontextprotocol.io), Plans, Subagents, Skills, User. Only known harness tool names are kept.

Home chats: personal agents. Project chats: personal plus project; same name, project wins (case-insensitive). Reserved slash names `ask`, `plan`, `agent`, `orchestrator` are hidden from `/`, same as skills.

## Run from `/`

The slash index lists agents next to [skills](/customize/skills). Mentions of type `agent` do not dump the instructions into the parent prompt. The parent is told to call `spawn_subagent` for each named catalog agent, with `agentName` set to that name exactly.

The catalog also appears as `Available subagents:` in the system prompt.

## What spawn does

When `agentName` matches a catalog agent, that definition is used. Any other name spawns a generic helper labeled with that name, so prefer a short verb phrase that describes the task.

The file body is the sub-agent system prompt (`Follow the agent definition below.`). Optional **model** from frontmatter is used unless the spawn call or a plan lock overrides it. Optional **tools** intersect the read-only or write allowlist. Absent `tools` keeps the full capability set for that spawn.

Default spawn capabilities: `read-only`. Ask and Plan cannot spawn `write` sub-agents. `blocking` vs `background`: background returns immediately; the parent can `steer_subagent`. MCP is allowed if trusted. Task text is treated as untrusted.

See [Orchestrate sub-agents](/using/orchestrate-sub-agents) and [Chat modes](/concepts/chat-modes).
