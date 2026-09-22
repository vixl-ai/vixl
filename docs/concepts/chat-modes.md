---
title: Chat modes
description: Vixl chat modes are Agent, Ask, Orchestrator, and Plan, each with a built-in skill and a tool allowlist.
---

# Chat modes

The chat input has a mode picker: Agent, Ask, Orchestrator, Plan. A new chat defaults to Agent. Changing mode on an existing chat keeps the current model unless the model field is empty, in which case it fills the [role default](/concepts/models-and-roles) for that mode.

Each mode has a built-in skill inlined into the system prompt, and a tool allowlist. Tools that are not on the list do not exist for that turn.

## Agent

Agent implements changes. It can read and search, call [LSP](https://microsoft.github.io/language-server-protocol/) and diagnostics, fetch the web, call [MCP](https://modelcontextprotocol.io/), load skills, ask you questions, resolve models, spawn and steer sub-agents, and write files (`write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`). It has the shell suite (`run_terminal`, `terminal_output`, `stop_terminal`) and [git](https://git-scm.com/) mutations (`git_checkout`, `git_branch_create`, `git_commit`). It can `create_plan`, revise plan bodies (`update_plan`), update plan todos, keep an in-chat task list (`update_todos`), and `move_workspace`.

The Agent skill says to prefer write and edit tools over shell redirects, and not to commit unless you ask. `git_commit` stages the paths it is given, then runs `git commit -m`. It will not `git add -A`. Vixl does not tell the agent to commit or branch, and it does not add itself or the model as a co-author.

Use Agent for work you want done in this chat. Use `create_plan` when the work should become a durable plan with Build or Orchestrate, rather than an in-chat task list.

## Ask

Ask is read-only exploration. It can read files, grep, glob, list directories, query the [code graph](/concepts/code-graphs), inspect git (`git_status`, `git_diff`, `git_log`, `git_branch`), use LSP and diagnostics, load skills, ask you questions, fetch the web, call MCP, resolve models, and spawn or steer sub-agents.

Shell is allowed for investigation. Approvals still apply. Ask cannot write, edit, patch, delete, or move files, and it has no git mutations. It cannot `create_plan`. Ask and Plan both reject write-capable `spawn_subagent`. Responses cite files and symbols, and point at Agent or Plan when a change is needed.

## Plan

Plan is Ask plus `create_plan`, `update_plan`, and `update_plan_todo`. It still cannot mutate source. Write-capable `spawn_subagent` is rejected, same as Ask. Research first (reads, graph, MCP, web, sub-agents), then write `PLAN.md`.

A plan is not a throwaway message. You pay for those tokens, and they are decisions you made. Like database migrations, plans are version-controlled records of a lifecycle, persisted so later agents have something solid to ground on. That is one of the few opinions Vixl has.

`create_plan` writes `.vixl/plans/<id>/PLAN.md` with frontmatter (id, title, createdAt, mode, optional source chat, todos) and required sections: Summary, Context, Architecture ([mermaid](https://mermaid.js.org/)), Approach, Test plan. The workbench opens a plan tab. The agent is told to stop. Mutation tools, MCP calls, spawn/steer, and further `create_plan` are blocked until you choose Build or Orchestrate on that tab. `update_plan` and `update_plan_todo` remain. `update_todos` is Agent and Orchestrator only.

Build starts (or resumes) an Agent-mode chat against the plan. Orchestrate starts an Orchestrator-mode chat and can lock the nested sub-agent model. See [Work with plans](/using/work-with-plans).

## Orchestrator

Orchestrator coordinates through sub-agents. The parent must not mutate files or run shell. After a folder or worktree exists, the parent may `move_workspace` before spawning implementers. Implementers wait until the chat is on that workspace.

The parent can read and search, inspect git, use LSP, load skills, ask you questions, call MCP, `create_plan` / `update_plan` / `update_plan_todo` / `update_todos`, spawn and steer sub-agents, and resolve models. It has no `write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`, no shell suite, and no git mutations.

The orchestrator skill says to use your MCP servers for network, not built-in fetch. The allowlist still includes `web_fetch`. Background spawns are preferred. The parent leaves a one-line status and ends the turn. The harness resumes when a sub-agent finishes. `terminal_output` is not how that wait works. Nested agents cannot spawn further sub-agents.

See [Orchestrate sub-agents](/using/orchestrate-sub-agents) and [Best practices](/using/best-practices).

## Git neutrality

Vixl has git tools. Built-in prompts never tell the agent to commit, branch, or follow a git flow. Agent can commit if you ask. The commit is `git commit -m` with the message and paths from the tool call. No co-author trailer.

[Permissions and approvals](/concepts/permissions-and-approvals) still gate writes, shell, git, web, and MCP on top of the mode allowlist.
