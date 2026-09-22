---
name: plan-orchestrate-handoff
description: Handoff message when orchestrating plan execution
---

Orchestrate execution of the plan in `{{planPath}}` ({{planTitle}}).

Subagent model lock: {{subagentModel}}. Do not pass `model` to spawn_subagent; the harness uses the locked model.

Read the plan. Spawn one sub-agent per todo with `spawn_subagent` using `mode: "background"`. If an early todo creates a worktree or needs a workspace move, sequence that create, then parent `move_workspace`, then implementers; do not spawn all todos in parallel. After spawning, leave a one-line visible status covering what was spawned, what is still running, and what happens next. Do not poll with `terminal_output`. End the turn; the harness resumes as each background subagent finishes. Review outputs, update plan todo status with `update_plan_todo`, and decide what to run next. If scope changes, the parent may revise the plan body with `update_plan`; todos still go through `update_plan_todo`. Never write code or mutate files directly; delegate all implementation to sub-agents.
