---
title: Chat modes
description: Vixl chat modes are Agent, Ask, Orchestrator, and Plan, each with a built-in skill, a parent tool allowlist, and nested sub-agent tools.
---

# Chat modes

The chat input has a mode picker: Agent, Ask, Orchestrator, and Plan. A new chat defaults to Agent. Changing mode on an existing chat keeps the model you already picked. If the model field is empty, it fills the [role default](/concepts/models-and-roles) for that mode.

Each mode inlines a built-in skill into the system prompt and exposes only the tools on that mode's allowlist. Tools that are not on the list do not exist for that turn. [Permissions](/concepts/permissions-and-approvals) still gate writes, shell, git, web, and MCP on top of the allowlist.

## Capabilities

| Capability | Ask | Plan | Agent | Orchestrator |
| --- | --- | --- | --- | --- |
| Read, search, list | yes | yes | yes | yes |
| Code graph | yes | yes | yes | yes |
| Git inspect (`git_status`, `git_diff`, `git_log`, `git_branch`) | yes | yes | yes | yes |
| Git mutate (`git_checkout`, `git_branch_create`, `git_commit`) | no | no | yes | no |
| File writes (`write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`) | no | no | yes | no |
| Shell (`run_terminal`, `terminal_output`, `stop_terminal`) | yes | yes | yes | yes |
| LSP and diagnostics | yes | yes | yes | yes |
| Web fetch | yes | yes | yes | yes |
| MCP | yes | yes | yes | yes |
| `load_skill`, `ask_user`, `resolve_models` | yes | yes | yes | yes |
| `spawn_subagent`, `steer_subagent` | yes | yes | yes | yes |
| Write-capable spawn | no | no | yes | yes |
| `create_plan`, `update_plan`, `update_plan_todo` | no | yes | yes | yes |
| In-chat `update_todos` | no | no | yes | yes |
| `move_workspace` | no | no | yes | yes |

## Nested sub-agents

`spawn_subagent` takes `capabilities`: `read-only` (the default) or `write`. Ask and Plan reject write-capable spawns. Agent and Orchestrator can spawn either.

A read-only nested agent can use `read_file`, `list_dir`, `grep`, `glob_files`, `codebase_explore`, `codebase_search`, `codebase_impact`, `codebase_status`, git inspect (`git_status`, `git_diff`, `git_log`, `git_branch`), `lsp`, `diagnostics`, `load_skill`, `web_fetch`, the shell suite (`run_terminal`, `terminal_output`, `stop_terminal`), and MCP (`get_mcp_tool`, `get_mcp_tools`, `call_mcp_tool`, `list_mcp_resources`, `read_mcp_resource`, `get_mcp_prompt`).

A write-capable nested agent also gets `write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`, `git_commit`, `git_checkout`, and `git_branch_create`.

Nested agents cannot spawn further sub-agents (no `spawn_subagent` or `steer_subagent`). They also do not get plan tools (`create_plan`, `update_plan`, `update_plan_todo`), in-chat `update_todos`, `ask_user`, `move_workspace`, or `resolve_models`.

## Agent

Agent implements changes in this chat. Prefer it when you want the work done here rather than handed to a durable plan. The skill tells it to prefer write and edit tools over shell redirects, and not to commit unless you ask. Use `create_plan` when the work should become a plan with Build or Orchestrate, rather than an in-chat task list.

## Ask

Ask is read-only exploration. Shell is allowed for investigation; approvals still apply. It cannot mutate source or git, and it cannot `create_plan`. Responses cite files and symbols, and point at Agent or Plan when a change is needed.

## Plan

Plan is Ask plus plan tools. It still cannot mutate source. Research first (reads, graph, MCP, web, sub-agents), then write `PLAN.md`. After `create_plan` succeeds, writes, shell, git mutations, MCP, spawn, steer, and a second `create_plan` are blocked until you choose **Build** or **Orchestrate** on the plan tab. `update_plan` and `update_plan_todo` stay available. How those buttons start the next chat is on [Work with plans](/using/work-with-plans). Why plans stay on disk is on [Philosophy](/getting-started/philosophy).

## Orchestrator

Orchestrator coordinates through sub-agents. The parent has no file-write tools and no git mutations, so it cannot edit source itself. It does have the shell suite. The built-in skill says to use that shell only for validation (CI, tests, lint, typecheck, `gh`), not for mutating commands. After a folder or worktree exists, the parent may `move_workspace` before spawning implementers.

Background spawns are preferred. The parent leaves a short status and ends the turn. The harness resumes the parent when a sub-agent finishes. `terminal_output` is not how that wait works. Network goes through `web_fetch`, user MCP, or validation shell commands such as `gh`.

See [Orchestrate sub-agents](/using/orchestrate-sub-agents) for spawn, steer, and how to run them.

## Git neutrality

Vixl has git tools. Built-in prompts never tell the agent to commit, branch, or follow a git flow. Agent can commit if you ask. `git_commit` stages the paths it is given, then runs `git commit -m`. It will not stage everything with `git add -A`. The commit message is the one from the tool call. Vixl does not add itself or the model as a co-author.
