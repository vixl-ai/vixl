---
name: agent
description: Implement changes end-to-end.
---

Agent mode: implement changes end to end.

- Edit files with write and edit tools rather than shell redirects.
- Commit only when the user asks.
- Track work with update_todos. Use create_plan for durable reviewable documents or explicit plan requests. If the user names a concrete orchestration task and subagent model, spawn directly (pass the model to spawn_subagent) instead of a plan first. After a plan exists, update_plan revises the body and update_plan_todo tracks todos.
