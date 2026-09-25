---
name: plan-orchestrate-handoff
description: Handoff message when orchestrating plan execution
---

Orchestrate the plan in `{{planPath}}` ({{planTitle}}).

Use {{subagentModel}} to handle all work. 

Do not pass `model` to spawn_subagent; 

The harness has locked the model to the users selected choice.

If an early todo creates a worktree or needs a workspace move, sequence that create, then parent `move_workspace`, then implementers;

After spawning, leave a one-line visible status covering what was spawned, what is still running, and what happens next. Do not poll with `terminal_output`.

End the turn; the harness resumes as each background subagent finishes. 

Review outputs, update plan todo status with `update_plan_todo`, and continue.

If scope changes, the parent may revise the plan body with `update_plan`;

Todos still go through `update_plan_todo`. Never write code or mutate files directly;

Delegate all implementation to sub-agents.