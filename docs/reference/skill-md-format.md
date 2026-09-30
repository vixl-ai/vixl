---
title: SKILL.md format
description: SKILL.md frontmatter, folder layout, and how Vixl resolves skill names.
---

# SKILL.md format

A skill is a folder that contains `SKILL.md`. Agents see a short catalog, then load the body with `load_skill`. You can attach one from the chat input with `/`. How-to: [Skills](/customize/skills).

## Locations and names

| Scope | Path |
| --- | --- |
| Personal | `{app data}/.vixl/skills/{slug}/SKILL.md` |
| Project | `<repo>/.vixl/skills/{slug}/SKILL.md` |
| Built-in | shipped with the app |

The list name is the folder name, not the frontmatter `name`. Creating from the UI slugifies the name (lowercase, hyphens). Description comes from YAML `description`.

Reserved slash names cannot run via `/`: `ask`, `plan`, `agent`, `orchestrator`. Those are [chat modes](/concepts/chat-modes).

## SKILL.md document

```markdown
---
name: "deploy"
description: "Ship the app"
---

Steps to deploy this repo.
```

Frontmatter schema:

| Field | Type | Required | Effect |
| --- | --- | --- | --- |
| `name` | string, min length 1 | yes | Display name inside the file. The catalog still keys off the folder name |
| `description` | string, min length 1 | yes | Shown in `/` and in Available skills |

There are no other frontmatter fields. The create form JSON-stringifies `name` and `description`. Body is free markdown.

Loaders strip frontmatter and inject the body. If the loaded body is longer than 4000 characters, it is truncated and the agent is told characters were omitted.

## How a name is resolved

Load by name (case-insensitive): built-in first, then project, then personal.

`/` and the Available skills list merge in this order: vendored command skills first, then personal, then project overlay (project wins over personal). Vendored command skills cannot be overridden by a same-named user or project skill.

Vendored command skills: `create-agent`, `create-skill`, `create-rule`, `create-plan`. They are listed in `/` and in Available skills, including on home chats. The matching built-in mode skill (`ask`, `plan`, `agent`, `orchestrator`) is inlined for that chat mode and omitted from Available skills.

What `/` versus Available skills shows on a home chat versus a project chat is on [Context](/concepts/context). Selecting `/` inserts a skill mention. The agent loads the full text with `load_skill`. Missing name, unknown name, and catalog load failures return errors.

See [Custom agent frontmatter](/reference/custom-agent-frontmatter) for the sibling agent file format.
