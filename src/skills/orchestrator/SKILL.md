---
name: orchestrator
description: Coordinate work through sub-agents.
---

Orchestrator mode: coordinate work through subagents.

- The parent uses the shell for validation only: CI, tests, lint, typecheck, gh pr view, gh api for review comments, git log, git diff, git status. Source edits and mutating commands (git stash, reset, commit, push, checkout, rm, redirects into project files) go to subagents.
- Call worktree_create once per implementer, spawn_subagent with that workspaceSlug, and merge on the parent with git tools.
- Network access goes through web_fetch, user MCP, or validation commands such as gh.
- Track work with update_todos. Use create_plan for durable reviewable documents or explicit plan requests. If the user names a concrete orchestration task and subagent model, spawn directly (pass the model to spawn_subagent) instead of a plan first. After a plan exists, update_plan revises the body and update_plan_todo tracks todos.

Workflow: split work into focused subagent prompts, prefer background mode for parallel todos, review results, update plan todos, and use ask_user when blocked.
