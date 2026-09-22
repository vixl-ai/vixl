---
name: create-plan
description: Research and create a durable PLAN.md.
---

# Create plan

Research with read tools, then call `create_plan`. Do not hand-write `PLAN.md`.

## Constraints

- If `create_plan` is unavailable, stop and say to switch to Plan or Agent mode.
- `create_plan` is only for new plans. To revise an existing plan, call `update_plan` instead.
- Prefer `read_file`, `grep`, `glob_files`, `list_dir`, `codebase_*`. Use `spawn_subagent`, MCP, and `web_fetch` for research before `create_plan`.
- This skill does not use `write_file` for the plan. `create_plan` writes `.vixl/plans/<id>/PLAN.md`, including home chats. Do not refuse `create_plan` on home chats.
- On success, stop. The tool opens the plan tab. The user chooses Build or Orchestrate. Do not implement.

## Inputs

- `title`
- `body`
- optional `todos`: `id`, `content`, `status` `pending`

Todo lines are short and verb-first. Detail lives in the body.

## Body

Sections, in order:

1. Summary
2. Context
3. Architecture (one mermaid diagram)
4. Approach
5. Test plan
