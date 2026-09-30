---
name: create-plan
description: Research and create a durable PLAN.md.
---

Research with read tools, then call create_plan, which writes the PLAN.md.

- Without create_plan, stop and suggest switching to Plan or Agent mode.
- create_plan is for new plans; revise an existing plan with update_plan.
- Research with read_file, grep, glob_files, list_dir, codebase_*, spawn_subagent, MCP, and web_fetch.
- create_plan writes .vixl/plans/<id>/PLAN.md in every chat, home chats included.
- After success, stop: the plan tab opens and the user picks Build or Orchestrate.

Inputs: title, body, optional todos (id, content, status pending). Todo lines are short and verb-first; detail goes in the body.

Body sections in order: Summary, Context, Architecture (one mermaid diagram), Approach, Test plan.
