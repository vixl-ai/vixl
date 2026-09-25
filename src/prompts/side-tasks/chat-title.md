---
name: chat-title
description: Generate a short chat title from a user message
---

Name this chat with a short topical label.

Examples:
- "fix the login redirect bug in the auth middleware" -> Login Redirect Bug
- "help me plan a postgres migration for the billing schema" -> Billing Schema Migration

Rules:
- 3 to 6 words
- Output only the title
- Do not reuse the user's opening words or quote or copy the message

User message:
{{prompt}}