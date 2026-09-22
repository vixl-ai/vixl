---
title: Orchestrate sub-agents
description: Orchestrator mode locks the Vixl parent to guiding sub-agents; it does not write files, run shell, or mutate git itself.
---

# Orchestrate sub-agents

[Orchestrator mode](/concepts/chat-modes) is the lock: the parent guides sub-agents. It does not write files, edit, patch, delete, move files, run shell, or run [git](https://git-scm.com) mutations itself.

The mode allowlist is reads, codebase tools, git status/diff/log/branch, lsp, diagnostics, `load_skill`, `ask_user`, `web_fetch`, [MCP](https://modelcontextprotocol.io) getters/calls, `create_plan`, `update_plan`, `update_plan_todo`, `update_todos`, `spawn_subagent`, `steer_subagent`, `resolve_models`, and `move_workspace`. The built-in skill says: Never mutate files or run shell from the parent. Exception: after a folder or worktree exists, the parent may call `move_workspace` before spawning implementers. The skill also says network via user MCP only; `web_fetch` is still on the allowlist.

Approvals still apply. See [Permissions and approvals](/concepts/permissions-and-approvals).

## Spawn

The parent calls `spawn_subagent`. `agentName` is a catalog custom-agent name, or a 2 to 6 word verb phrase for a generic helper. `prompt` is the task. `mode` is `blocking` (default) or `background`. Optional `model` is an exact `provider::modelId` from `resolve_models` (ignored when a plan locked a subagent model). `capabilities` is `read-only` (default) or `write`.

Ask and Plan cannot spawn write-capable helpers. Nested agents cannot spawn further sub-agents. They also do not get `steer_subagent`, `create_plan`, `update_plan`, `update_plan_todo`, `update_todos`, `ask_user`, `move_workspace`, or `resolve_models`.

Read-only nested tools: reads, codebase, git status/diff/log/branch, lsp, diagnostics, `load_skill`, `web_fetch`, MCP. Write adds write/edit/patch/delete/move, the terminal suite, and git commit/checkout/branch_create.

Model pick order when there is no plan lock: the spawn `model` argument, else the agent file's `model`, else Settings `models.subagent`. Fuzzy names are rejected. Call `resolve_models` first. A plan Orchestrate lock ignores the spawn `model` and the agent-file model. See [Models and roles](/concepts/models-and-roles).

Background spawn returns `{ status: 'running' }` immediately. The parent should leave a one-line status and end the turn. The harness resumes the parent as each background subagent finishes. Do not treat a `subagentId` as a shell id.

Blocking spawn waits for a summary, then returns it.

Custom agents invoked with `/name` in the chat input force `spawn_subagent` for each named agent. See [Custom agents](/customize/custom-agents).

## Monitor running sub-agents

Running work shows inline on the turn, and as a stack pill `1 agent` / `N agents`. Open the pill for the list. Stop sub agent aborts that one.

Open the nested thread at `/chat/:chatId/subagent/:subagentId` (or the project equivalent). That transcript is read-only. The chat input there steers: the follow-up is delivered at the next nested step, or it resumes a finished or failed subagent in the background. The parent can also call `steer_subagent`.

Stop generating on the parent aborts every subagent for that chat. See [Queue and stop messages](/using/queue-and-stop-messages).

From a plan tab, Orchestrate is the same lock plus a subagent model lock. See [Work with plans](/using/work-with-plans) and [Best practices](/using/best-practices).
