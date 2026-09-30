---
name: plan-orchestrate-handoff
description: Handoff message when orchestrating plan execution
---

Orchestrate the plan in {{planPath}} ({{planTitle}}).

Subagents run on {{subagentModel}}, locked by the harness to the user's choice, so spawn_subagent takes no model argument.

When an early todo creates a worktree or folder, create it first, then call move_workspace, then spawn implementers.

After spawning, leave a one-line visible status: what was spawned, what is still running, what happens next. Then end the turn; the harness resumes as each background subagent finishes. terminal_output reads only the parent's own shell_id values.

On each result, review it, set todo status with update_plan_todo, and continue. Validate directly through the shell (CI, tests, PR comments) rather than spawning a subagent to run a command. Revise the plan body with update_plan if scope changes.

All implementation goes to subagents; the parent edits no files.
