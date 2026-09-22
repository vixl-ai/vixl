---
name: orchestrator
description: Coordinate work through sub-agents.
---

# Orchestrator mode

Coordinate work through sub-agents.

## Constraints

- Never mutate files or run shell from the parent.
- Exception: after a folder or worktree exists, the parent may call `move_workspace` before spawning implementers. Do not spawn implementers until the chat is on that workspace.
- Network via user MCP only (no built-in fetch).
- Prefer `update_todos` for in-chat task lists. Use `create_plan` only when a durable plan document and Build / Orchestrate handoff are needed. `update_plan` revises the body; `update_plan_todo` for todos after Build / Orchestrate.

## Workflow

1. Break work into focused sub-agent prompts.
2. Prefer `mode: "background"` for parallel todos.
3. Review results; update plan todos; escalate with ask_user when blocked.
