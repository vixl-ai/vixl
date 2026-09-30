---
title: Orchestrate sub-agents
description: Run work through Orchestrator mode and nested sub-agents, from a plan tab or by switching the chat to Orchestrator.
---

# Orchestrate sub-agents

Orchestrator mode is for splitting work across nested agents. The parent stays on the long context and guides; workers get a focused prompt and do the writes, often on the cheaper Subagent role. You can start from a plan's **Orchestrate**, or switch the mode picker to **Orchestrator** and describe the work ad hoc.

The parent does not write files or run git mutations. It can still read the repo, run shell (the [allowlist](/concepts/chat-modes) includes it; the built-in skill limits it to validation such as tests, CI, and `gh`), and spawn sub-agents. Approvals still apply; see [Permissions and approvals](/concepts/permissions-and-approvals).

## From a plan

On a plan tab, **Orchestrate** starts (or resumes) an Orchestrator-mode chat, locks the nested sub-agent model, and tells the parent to spawn one background sub-agent per open todo. After spawning, the parent leaves a one-line status and ends the turn. The harness resumes the parent as each worker finishes. The parent then reviews output, updates plan todos, and continues. Lifecycle and the dialog are on [Work with plans](/using/work-with-plans).

A plan lock ignores a `model` argument on `spawn_subagent` and ignores a model pinned in a custom agent file. Workers use the Subagent pick from the dialog.

## Ad hoc

Set the mode picker to **Orchestrator** and send the task. The parent calls `spawn_subagent` the same way, without a plan file or a locked sub-agent model.

Agent mode can also spawn sub-agents, but that parent can still write files itself. Use Orchestrator when you want the parent locked to guiding. Ask and Plan can spawn read-only helpers for research; they cannot spawn write-capable ones.

## Background vs blocking

`spawn_subagent` takes `mode`: `blocking` (the default) or `background`.

A blocking spawn waits until that worker finishes, then returns its summary. A background spawn returns immediately with status `running`. The parent should leave a one-line status covering what was spawned and what happens next, then end the turn. The harness resumes the parent as each background worker finishes. A terminal is not how the parent waits on a worker.

For parallel todos, prefer background. The plan-orchestrate handoff does that: one background worker per todo.

`agentName` is a catalog custom-agent name, or any other label (a short verb phrase) for a generic helper. `prompt` is the task. `capabilities` is `read-only` (default) or `write`.

## What a sub-agent can do

Read-only workers can explore, and they can run tests, lint, and similar commands in a sandbox where the project is not writable. Write workers can edit files and use git commit, checkout, and branch-create. Nested agents cannot spawn further sub-agents. The nested tool lists are on [Chat modes](/concepts/chat-modes#nested-sub-agents).

## Which model a worker uses

When there is no plan lock, the model is the spawn call's exact `provider::modelId` (from `resolve_models`), else the custom agent's `model` frontmatter, else Settings **Subagent** (`models.subagent`). Fuzzy names are rejected. See [Models and roles](/concepts/models-and-roles).

## Custom agents as sub-agents

A `/name` mention of a catalog agent tells the parent to call `spawn_subagent` for each named agent, with `agentName` set to that name exactly. The file body becomes the worker's system prompt. Optional `tools` in the agent file intersect the nested allowlist. See [Custom agents](/customize/custom-agents) and [Chat modes](/concepts/chat-modes#nested-sub-agents).

## Watch, steer, and stop

Running workers show inline on the turn, and as a stack pill (`1 agent` / `N agents`). Open the pill for the list. **Stop sub agent** stops that one.

Open the nested thread from the turn (or the pill). That view is the worker's transcript. Send from the input there to steer: the follow-up is delivered at the next nested step, or it resumes a finished or failed worker in the background. The parent can also call `steer_subagent`.

**Stop generating** on the parent stops every sub-agent for that chat. Stopping from the nested thread stops only that worker. See [Queue and stop messages](/using/queue-and-stop-messages).

Cost, cache, and when to keep the parent on the planning model are on [Best practices](/using/best-practices).
