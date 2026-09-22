---
title: Work with plans
description: Vixl plans are durable PLAN.md files; Plan mode researches and writes the plan, then Build or Orchestrate implements it.
---

# Work with plans

Plans are durable. Planning is not a throwaway turn. You pay for plan tokens and they are decisions you made. Like database migrations, plans are version-controlled records of a lifecycle, persisted to keep history and ground agents. That is one of the few opinions Vixl has.

A plan is a `PLAN.md` under [`.vixl/plans/`](/concepts/the-vixl-directory): `.vixl/plans/<slug>-<YYYY-MM-DD-HHMMSS>/PLAN.md`. Frontmatter holds id, title, createdAt, `mode: plan`, optional `sourceChatId`, and `todos[]`. Todos are short verb-first lines; detail lives in the plan body. Home chats write under the home workspace after that root exists.

## Create a plan in Plan mode

Settings > Plans and the project Plans tab can create a plan without a chat.

[Plan mode](/concepts/chat-modes) can research (reads, grep, git status/diff/log/branch, shell for investigation, [MCP](https://modelcontextprotocol.io), spawn_subagent) and can call `create_plan` / `update_plan` / `update_plan_todo`. It cannot mutate source files.

Required `PLAN.md` sections: Summary, Context, Architecture ([mermaid](https://mermaid.js.org) diagram), Approach, Test plan.

1. Set the mode picker to Plan.
2. Describe the work in the chat input.
3. Send.

When `create_plan` succeeds, Vixl opens a plan tab and the agent is told to stop. Mutation tools stay blocked until you click Build or Orchestrate on that tab. A second `create_plan` is refused until then. `update_plan` still works while a plan awaits Build / Orchestrate. `update_plan_todo` and in-chat `update_todos` still work.

You can also start from Settings or the project Plans tab. New plan offers Chat (a new Plan-mode chat) or Form (Title, Todos, Description). Form saves with Create plan. Click a row to open it in the workbench.

## Plan tab

The tab shows the title, the YAML todos (Pending, In progress, Completed, Cancelled), then the markdown body with mermaid blocks rendered.

While todos remain open, the header has Orchestrate (network icon) and Build (hammer). Orchestrate opens Orchestrate plan, with Parent (default orchestrator role) and Subagent (default nested subagent role). The dialog button is Orchestrate. Build opens the Build plan dialog.

If a build chat is already running, the Build slot swaps to Open the active build chat (running dots). Orchestrate stays visible and is disabled. When every todo is completed or cancelled, Build and Orchestrate hide and a Done check appears.

A document that does not parse disables actions.

## Build

Build opens a dialog titled Build plan. Pick a Model. Optional checkbox: Build in a fresh chat (new context). Unchecked by default. Click Build.

Without the checkbox, Build reuses `lastBuildChatId`, else `sourceChatId`, if that chat still exists and is not running. Missing both, Vixl creates a new chat titled with the plan title. With the checkbox checked, Build always creates a fresh chat.

Build starts (or resumes) the chat in Agent mode with the chosen model and a pending handoff that tells the agent to read `PLAN.md` and work through its todos. Orchestrate starts Orchestrator mode, locks `subagentModel` on the chat, and tells the parent to spawn one background sub-agent per todo. See [Best practices](/using/best-practices) for why the buttons are split that way.

If that chat is already running, Build is refused. Build needs a Default or Agent model in Settings. Orchestrate needs a sub-agent model.

After a start, plan frontmatter gets `builtAt`, `lastBuildChatId`, and `lastBuildModel`. Stale chat ids are cleared if those chats are gone.

[Orchestrate sub-agents](/using/orchestrate-sub-agents)
