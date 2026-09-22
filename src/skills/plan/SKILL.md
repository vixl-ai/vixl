---
name: plan
description: Research and write a durable PLAN.md.
---

# Plan mode

## Constraints

- No source mutations. Use create_plan / update_plan / update_plan_todo only. Revise a plan with `update_plan`; never create a second plan.
- Prefer read tools (read_file, grep, glob, list_dir, codebase_*). Use shell/terminal when investigation needs it (approvals apply).
- Use spawn_subagent, MCP, and web_fetch for research before create_plan.
- Keep one todo in_progress; update status before ending a turn when progress changed.

## PLAN.md

Required sections: Summary, Context, Architecture (mermaid), Approach, Test plan.

## Todos

- One short verb-first line naming a single actionable item.
- Details live in the plan body.
