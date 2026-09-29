---
title: Skills
description: A Vixl skill is a SKILL.md file; agents see a catalog, load full text with load_skill, and you can attach one with /.
---

# Skills

Create skills from Settings > Skills or the project Skills tab with the New skill sheet. A skill is a `SKILL.md` file: YAML frontmatter plus a markdown body. Agents see a catalog, can load the full text with `load_skill`, and you can attach one from the [chat input](/getting-started/your-first-chat) with `/`.

Usage-level format (name and description required):

```markdown
---
name: "deploy"
description: "Ship the app"
---

Steps to deploy this repo.
```

The create form JSON-stringifies name and description. The body is free markdown. Loaders strip frontmatter and inject the body. Bodies over 4000 characters are truncated when loaded. Full field spec: [SKILL.md format](/reference/skill-md-format).

## Personal vs project

- Personal: Settings > Skills. Files: `{appData}/.vixl/skills/{slug}/SKILL.md`.
- Project: project Skills tab. Files: `<repo>/.vixl/skills/{slug}/SKILL.md`.

**New skill** opens a sheet: Name, Description, Body. Create writes the file. Click a row to open it in the workbench editor. Reveal in folder creates `skills/` if needed.

Home chats: `/` lists vendored command skills, personal skills, and skills under the home workspace `.vixl`. Project chats: those plus project. Same name, case-insensitive: project wins over personal. A same-named user or project skill cannot override a vendored command. Loading by name tries built-in first, then project, then personal.

## How agents discover skills

`/` on the chat input lists vendored command skills, user and project skills, and [custom agents](/customize/custom-agents). On a home chat, `/` lists vendored command skills, personal skills and agents, and skills and agents under that home workspace `.vixl`. Placeholder: `@ for context, / for commands`. Reserved slash names cannot run via `/`: `ask`, `plan`, `agent`, `orchestrator`.

Selecting a skill inserts a mention. On send, that becomes a `Skill {name}` block in the prompt. Agents can also call `load_skill` with the skill name, without a `/` mention.

Project chats include an `Available skills:` list in the system prompt (`name: description`). The matching built-in mode skill is inlined for that [chat mode](/concepts/chat-modes), then omitted from the list. On a home chat, Available skills lists vendored commands and home-workspace skills. It does not add personal skills.

Built-in skills ship with the app. `/create-agent`, `/create-skill`, `/create-rule`, and `/create-plan` are vendored command skills. They are listed in `/` and in Available skills. They work on home chats. The workspace root is the user home directory. The agent writes the same relative `.vixl/` paths there with `write_file` (or `create_plan` for plans). The agent loads them with `load_skill`. A same-named user or project skill cannot override them: the slash index and catalog keep the vendored command, and `load_skill` already prefers internal.

Mode skills `ask`, `plan`, `agent`, and `orchestrator` stay hidden from `/` and stay inlined only in their matching chat mode, then omitted from Available skills. `agent` inlines in Agent mode (implement end to end, prefer write tools, no commit unless asked). `ask` inlines in Ask mode (read-only, no file or git mutations). `plan` inlines in Plan mode (research and write `PLAN.md`, no source mutations). `orchestrator` inlines in Orchestrator mode (coordinate sub-agents; the parent can run validation commands but never edits files).

See [Context](/concepts/context) and [the `.vixl` directory](/concepts/the-vixl-directory). Next: [Custom agents](/customize/custom-agents).
