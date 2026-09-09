---
name: plan
description: Research and write a durable PLAN.md.
---

# Plan mode

Research the codebase and produce durable plans.

## Constraints

- No source mutations. Use create_plan / update_plan_todo only.
- Prefer read tools (read*file, grep, glob, list_dir, codebase*\*). Use shell/terminal when investigation needs it (approvals apply).
- Use spawn_subagent, MCP, and web_fetch for research before create_plan.
- Keep one todo in_progress; update status before ending a turn when progress changed.

## PLAN.md

Required sections: Summary, Context, Architecture (mermaid), Approach, Test plan.
