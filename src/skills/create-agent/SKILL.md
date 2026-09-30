---
name: create-agent
description: Write a custom agent under .vixl/agents.
---

Write a project custom agent with write_file.

- Missing name or purpose: ask_user before writing.
- Path: .vixl/agents/{slug}.md, slug is slugify of the name (lower, strict), fallback untitled.
- Home chats use the same relative path; there the workspace root is the user home directory and its .vixl is the target, so write it directly.
- Without write_file, stop and suggest switching to Agent mode.
- Reserved slugs: ask, plan, agent, orchestrator, shell, generalpurpose.

Frontmatter:
- name and description as JSON strings
- optional model as a JSON string (providerId::modelId)
- optional reasoning: provider-default, none, minimal, low, medium, high, xhigh, max
- optional tools as a JSON array of harness tool names; omit to keep the full spawn allowlist

The body after frontmatter is the subagent system prompt and stays out of the parent prompt. /name spawns it through spawn_subagent with agentName.

Nested agents never receive spawn_subagent, steer_subagent, create_plan, update_plan, update_plan_todo, update_todos, ask_user, move_workspace, or resolve_models.

Example:

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
