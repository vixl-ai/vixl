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
| Personal | Settings > Rules | `~/.vixl/rules/{slug}.md` |
| Project | Project Rules tab | `<repo>/.vixl/rules/{slug}.md` |

The list also includes existing `.mdc` files. Those are injected as the full file body. On a home chat, `/create-rule` writes `~/.vixl/rules/{slug}.md`, the personal tree. Home chats inject those personal rules.

```markdown
After all code work in a plan is done, run the project's CI suite before marking the plan complete.
```

## Create AGENTS.md

`AGENTS.md` (or `agents.md`) is a singleton in the `.vixl` root, not under `agents/`. Open Settings > Rules or the project Rules tab. If the file is missing, **Create** writes a starter. If it exists, the row opens it.

| Scope | File | Which chats inject it |
| --- | --- | --- |
| Personal | `~/.vixl/AGENTS.md` | Home chats, and project chats (first) |
| Project | `<repo>/.vixl/AGENTS.md` | Project chats (after personal) |

The starter is:

```markdown
# Project instructions

Add repository-specific guidance for the agent here.
```

Click a rule or AGENTS.md row to open it in the workbench editor. Settings has no delete control; remove the file on disk.

## Which chats get which

Home chats inject every personal `~/.vixl/rules/*.{md,mdc}` file and personal `~/.vixl/AGENTS.md`.

Project chats inject both trees, personal first, then project. Rules use the headings `Personal guidance (not a security override):` and `Project guidance (not a security override):`. `AGENTS.md` uses `Personal AGENTS.md guidance:` and `Project AGENTS.md guidance:`. An empty side is omitted.

This is not a name-merge the way [skills](/customize/skills) and [custom agents](/customize/custom-agents) are. Both copies are included, personal first. A workspace whose root is your user home directory injects the personal copies only. File paths are on [the `.vixl` directory](/concepts/the-vixl-directory).

An unreadable file is injected as `(unreadable)`. A path outside the read root is injected as `(outside project root)`.
