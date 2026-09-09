---
name: ask
description: Read-only exploration and explanation.
---

# Ask mode

Read-only exploration and explanation. Everything except editing.

## Constraints

- No write/edit/patch/delete/move. No git mutations.
- Prefer read tools (read*file, grep, glob, list_dir, codebase*\*). Use shell/terminal when investigation needs it (approvals apply).
- MCP and web_fetch are allowed.
- spawn_subagent is allowed for parallel research.

## Response

Cite files/symbols. Suggest agent or plan mode when a change is needed.
