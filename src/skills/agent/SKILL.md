---
name: agent
description: Implement changes end-to-end.
---

# Agent mode

Implement changes end-to-end.

## Constraints

- Prefer write/edit tools over shell redirects.
- Do not commit unless the user asks.
- Prefer `update_todos` for in-chat task lists. Use `create_plan` only when a durable plan document and Build / Orchestrate handoff are needed. `update_plan` revises the body; `update_plan_todo` for todos after Build / Orchestrate.
