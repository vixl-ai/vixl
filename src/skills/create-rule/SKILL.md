---
name: create-rule
description: Write a project rule under .vixl/rules.
---

Write a project rule with write_file.

- Missing name or purpose: ask_user before writing.
- Path: .vixl/rules/{slug}.md, slug is slugify of the name (lower, strict), fallback untitled.
- Home chats use the same relative path; there the workspace root is the user home directory and its .vixl is the target, so write it directly.
- Without write_file, stop and suggest switching to Agent mode.
- Reserved slugs: ask, plan, agent, orchestrator.

The file has no frontmatter and is injected whole into every project chat with no glob gate, so keep it short and specific.

Home chats inject only .vixl/AGENTS.md, not .vixl/rules. Write the rule file when the user asked for a rule; for always-on home guidance, write .vixl/AGENTS.md instead. Starter:

```markdown
# Project instructions

Add repository-specific guidance for the agent here.
```

Example rule:

```markdown
Edit files with write_file and edit_file rather than shell redirects. Commit only when the user asks.
```
