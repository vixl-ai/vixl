---
title: Custom agent frontmatter
description: Custom Vixl agents are markdown under .vixl/agents/; YAML frontmatter is optional and the body is the sub-agent prompt.
---

# Custom agent frontmatter

Custom agents are markdown files at `{scope}/.vixl/agents/{slug}.md`. Personal files sit under the app-data `.vixl`. Project files sit under `<repo>/.vixl/agents/`. Create them from Settings or the project Agents tab. Run them with `/` in the chat input. They spawn as sub-agents.

vixl parses YAML between the first pair of `---` lines as frontmatter. The rest is the agent body, which becomes the sub-agent system prompt.

```markdown
---
name: "reviewer"
description: "Review diffs for bugs"
model: "anthropic::claude-sonnet-4-5"
reasoning: high
tools: ["read_file", "grep", "git_diff"]
---

Focus on security and missing tests.
```

## Fields

All frontmatter fields are optional in the schema. Missing or invalid frontmatter loads as `{}`.

| Field | Type | Default when omitted |
| --- | --- | --- |
| `name` | string, min length 1 | Filename stem (`reviewer.md` becomes `reviewer`) |
| `description` | string, min length 1 | `name`, else the filename stem |
| `model` | string, min length 1 | Unset. Spawn uses the call `model`, else settings `models.subagent` |
| `reasoning` | reasoning level | Unset. Invalid values are dropped |
| `tools` | string array | Unset. The spawn keeps the full capability allowlist |

`reasoning` must be one of: `provider-default`, `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. Anything else is ignored.

`tools` may be a JSON array (`["read_file", "grep"]`) or a comma-separated string (`read_file, grep`). Names that are not on the spawn allowlist are dropped. Absent `tools` keeps the full read-only or write set for that spawn. Nested agents never get `spawn_subagent`, `steer_subagent`, `create_plan`, `update_plan`, `update_plan_todo`, `update_todos`, `ask_user`, `move_workspace`, or `resolve_models`.

Known harness tool names include `read_file`, `write_file`, `edit_file`, `apply_patch`, `delete_file`, `move_file`, `move_workspace`, `list_dir`, `glob_files`, `grep`, `codebase_explore`, `codebase_search`, `codebase_impact`, `codebase_status`, `git_status`, `git_diff`, `git_log`, `git_branch`, `git_checkout`, `git_branch_create`, `git_commit`, `lsp`, `diagnostics`, `run_terminal`, `terminal_output`, `stop_terminal`, `load_skill`, `ask_user`, `call_mcp_tool`, `get_mcp_tool`, `get_mcp_tools`, `list_mcp_resources`, `read_mcp_resource`, `get_mcp_prompt`, `create_plan`, `update_plan`, `update_plan_todo`, `update_todos`, `spawn_subagent`, `steer_subagent`, `resolve_models`, and `web_fetch`.

`model` is a model ref `providerId::modelId`. If the chat has `subagentModel` set (Orchestrate), spawn ignores both the call `model` and this field.

## Body

The markdown after frontmatter is the agent definition. It is not dumped into the parent prompt. A `/agent` mention tells the parent it must call `spawn_subagent` with that catalog name.

Project agents overlay personal agents with the same name (case-insensitive). Home chats see personal agents only.

Reserved slash names `ask`, `plan`, `agent`, and `orchestrator` are chat modes, not custom agents. Bare unknown single-word names fail spawn. `shell` and `generalpurpose` are rejected.

See [Custom agents](/customize/custom-agents) and [Chat modes](/concepts/chat-modes).
