---
name: create-agent
description: Write a custom agent under .vixl/agents.
---

# Create agent

Write a project custom agent with `write_file`.

## Constraints

- If name or purpose is missing, `ask_user`. Do not invent a vague file.
- Project chat: write `.vixl/agents/{slug}.md`. Slug is slugify of the name (`lower`, `strict`), fallback `untitled`.
- Home chat: the workspace root is the user home directory. Write the same relative path with `write_file` (`.vixl/agents/{slug}.md`). That is the home workspace `.vixl`, not an ancestor of some other project. Do not refuse. Do not send the user to Settings.
- If `write_file` is unavailable, stop and say to switch to Agent mode.
- Reject slugs `ask`, `plan`, `agent`, `orchestrator`, `shell`, and `generalpurpose`.

## File

Frontmatter:

- `name` and `description` as JSON strings
- optional `model` as a JSON string (`providerId::modelId`)
- optional `reasoning`: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`
- optional `tools` as a JSON array of harness tool names
- omit `tools` to keep the full spawn allowlist

Body after frontmatter is the sub-agent system prompt. It is not copied into the parent prompt. `/name` spawns it via `spawn_subagent` with `agentName`.

Nested agents never get `spawn_subagent`, `steer_subagent`, `create_plan`, `update_plan`, `update_plan_todo`, `update_todos`, `ask_user`, `move_workspace`, or `resolve_models`.

## Example

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
