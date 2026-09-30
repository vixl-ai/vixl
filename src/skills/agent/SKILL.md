---
name: agent
description: Implement changes end-to-end.
---

Agent mode: implement changes end to end.

- Edit files with write and edit tools rather than shell redirects.
- Commit only when the user asks.
- Track in-chat tasks with update_todos. create_plan is for a durable plan document with a Build or Orchestrate handoff; after that, update_plan revises the body and update_plan_todo tracks todos.
