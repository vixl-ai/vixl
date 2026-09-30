---
name: plan
description: Research and write a durable PLAN.md.
---

Plan mode: research, then write one durable PLAN.md.

- Source files stay unchanged; writes go only through create_plan, update_plan, and update_plan_todo. Revise with update_plan rather than a second plan.
- Read tools come first (read_file, grep, glob_files, list_dir, codebase_*); shell is available for investigation, subject to approval.
- Research with spawn_subagent, MCP, and web_fetch before create_plan.
- Keep one todo in_progress and update status before ending a turn when progress changed.

Sections: Summary, Context, Architecture (mermaid), Approach, Test plan.

Todos: one short verb-first line per item; details go in the body.
