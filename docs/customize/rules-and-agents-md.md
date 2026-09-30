---
title: Rules and AGENTS.md
description: Rules and AGENTS.md are always-on prompt text; they are not a security override and have no per-rule glob gating.
---

# Rules and AGENTS.md

Rules and `AGENTS.md` are always-on guidance injected into the chats that read them. They are not a security override and they have no per-rule glob gate: every listed file is included in full. Put short, specific instructions here (style, CI, do not commit unless asked). Put a procedure the agent should load on demand in a [skill](/customize/skills) instead.

How these pieces sit in the prompt is on [Context](/concepts/context).

## Create a rule

Type `/create-rule` in the [chat input](/getting-started/your-first-chat), or open Settings > Rules (personal) or the project Rules tab. The form asks for a name and a markdown body. Create writes `{slug}.md` with no frontmatter.

| Scope | Where you create it | File |
| --- | --- | --- |
| Personal | Settings > Rules | `{appData}/.vixl/rules/{slug}.md` |
| Project | Project Rules tab | `<repo>/.vixl/rules/{slug}.md` |

The list also includes existing `.mdc` files. Those are injected as the full file body. On a home chat, `/create-rule` writes `.vixl/rules/` under your user home. Home chats do not inject rules, so if you want always-on home guidance, write `AGENTS.md` instead.

```markdown
After all code work in a plan is done, run the project's CI suite before marking the plan complete.
```

## Create AGENTS.md

`AGENTS.md` (or `agents.md`) is a singleton in the `.vixl` root, not under `agents/`. Open Settings > Rules or the project Rules tab. If the file is missing, **Create** writes a starter. If it exists, the row opens it.

| Scope | File | Which chats inject it |
| --- | --- | --- |
| Personal | `{appData}/.vixl/AGENTS.md` | Home chats |
| Project | `<repo>/.vixl/AGENTS.md` | Project chats |

The starter is:

```markdown
# Project instructions

Add repository-specific guidance for the agent here.
```

Click a rule or AGENTS.md row to open it in the workbench editor. Settings has no delete control; remove the file on disk.

## Which chats get which

Project chats inject every project `.vixl/rules/*.{md,mdc}` file and the project `.vixl/AGENTS.md`. They do not fall back to personal `AGENTS.md` and they do not merge personal rules.

Home chats inject personal `AGENTS.md` only. They inject no rules files. Personal rules still appear in Settings > Rules so you can edit them.

This is not a name-merge the way [skills](/customize/skills) and [custom agents](/customize/custom-agents) are. Project vs home is which directory is read. File paths are on [the `.vixl` directory](/concepts/the-vixl-directory).

An unreadable file is injected as `(unreadable)`. A path outside the read root is injected as `(outside project root)`.
