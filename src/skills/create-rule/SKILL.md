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

The file has no frontmatter and no glob gate. Keep it short and specific.

A home-chat rule is written at .vixl/rules/{slug}.md. The workspace root is the user home, so the file is ~/.vixl/rules/{slug}.md. It is injected on home chats, and as personal guidance on project chats.

Example rule:

```markdown
Edit files with write_file and edit_file rather than shell redirects. Commit only when the user asks.
```
