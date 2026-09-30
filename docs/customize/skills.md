---
title: Skills
description: A skill is a SKILL.md pack the agent can load on demand; create one in Settings or with /create-skill.
---

# Skills

A skill is a folder with a `SKILL.md` file: a short catalog line plus a procedure the agent loads when it needs it. Use one for a repeatable workflow (deploy, a review checklist, release notes) so the full text is not in every prompt.

The complete field list is on [SKILL.md format](/reference/skill-md-format).

## Create a skill

The fastest path is the vendored `/create-skill` command. Type `/` in the [chat input](/getting-started/your-first-chat), pick **create-skill**, and send. The agent writes the file. `/create-agent`, `/create-rule`, and `/create-plan` work the same way for those other files.

You can also create one from Settings > Skills (personal) or the project Skills tab. The form asks for a name, a description, and a markdown body, then writes the file. Click a row to open it in the workbench editor.

| Scope | Where you create it | File |
| --- | --- | --- |
| Personal | Settings > Skills | `{appData}/.vixl/skills/{slug}/SKILL.md` |
| Project | Project Skills tab | `<repo>/.vixl/skills/{slug}/SKILL.md` |

On a home chat, `/create-skill` writes `.vixl/skills/{slug}/SKILL.md` under your user home directory. That is the home workspace tree, not the Settings personal tree. Both trees are on [the `.vixl` directory](/concepts/the-vixl-directory).

Name and description are required. The create form writes them as JSON strings. The body is markdown. Loaders strip the frontmatter and inject the body. Bodies over 4000 characters are truncated when loaded.

```markdown
---
name: "deploy"
description: "Ship this app when the user asks to deploy"
---

1. Run the test suite.
2. Build the production bundle.
3. Push the release tag the user named.
```

Every field is documented on [SKILL.md format](/reference/skill-md-format).

## How it takes effect

`/` lists skills and [custom agents](/customize/custom-agents). Selecting a skill inserts a mention. On send, that becomes a `Skill {name}` line in the prompt. The agent then calls `load_skill` with that name. It can also call `load_skill` from the catalog without a `/` mention.

Reserved names `ask`, `plan`, `agent`, and `orchestrator` cannot run via `/`. Those are [chat modes](/concepts/chat-modes). Their built-in skills are inlined only in the matching mode, then omitted from the catalog.

`/create-skill`, `/create-agent`, `/create-rule`, and `/create-plan` are vendored command skills. They show up in `/` and in Available skills, including on home chats.

## Discovery and precedence

Same name, case-insensitive: a project skill overlays a personal one. `load_skill` name resolution, `/` merge order, and vendored-command protection are on [SKILL.md format](/reference/skill-md-format). How catalogs land in the prompt, including home-chat `/` versus Available skills, is on [Context](/concepts/context).
