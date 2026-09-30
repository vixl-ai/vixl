---
name: create-skill
description: Write a project skill as SKILL.md.
---

Write a project skill with write_file.

- Missing name or purpose: ask_user before writing.
- Path: .vixl/skills/{slug}/SKILL.md, slug is slugify of the name (lower, strict), fallback untitled.
- Home chats use the same relative path; there the workspace root is the user home directory and its .vixl is the target, so write it directly.
- Without write_file, stop and suggest switching to Agent mode.
- Reserved slugs: ask, plan, agent, orchestrator, create-agent, create-skill, create-rule, create-plan.

Required frontmatter: name and description as JSON strings. The description says what the skill does and when to load it.

The body is the procedure, under 4000 characters since loaders truncate past that.

Example:

```markdown
---
name: "deploy"
description: "Ship the app when the user asks to deploy"
---

Steps to deploy this repo.
```
