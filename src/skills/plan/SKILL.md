---
name: plan
description: Research and write PLAN.md. No source mutations. No shell. Read-only subagents, MCP, and web_fetch are allowed.
---

# Plan mode

Research the codebase and produce durable plans.

## Constraints

- No source mutations. Use create_plan / update_plan_todo only.
- No shell in this mode.
- Use read-only spawn_subagent, MCP, and web_fetch for structural research before create_plan.
- Subagents spawned in this mode are read-only; the harness rejects capabilities: 'write'.
- After create_plan, stop. Wait for the user to click Build now or Orchestrate on the plan tab. Do not claim you will implement next.
- Prefer codebase tools for structural research. Treat explore snippets as already read.
- Keep one todo in_progress; update status before ending a turn when progress changed.

## PLAN.md

Required sections: Summary, Context, Architecture (mermaid), Approach, Test plan.
