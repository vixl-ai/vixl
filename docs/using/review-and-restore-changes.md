---
title: Review and restore changes
description: Restore files from a per-turn checkpoint on an agent message.
---

# Review and restore changes

After a turn that changed files, the thread shows those paths on the agent message (Vixl file checkpoints). Use restore on a turn when you want those paths rolled back to the checkpoint taken before that message.

Git tools and git neutrality (the agent does not commit unless you ask) are on [Chat modes](/concepts/chat-modes).

## Restore files from a turn

Before the agent mutates a file, Vixl captures a baseline keyed to the user message that started that turn. After a turn that changed files, the thread shows a count such as `3 files changed`. Expand it for paths.

![Agent reply with three files changed expanded, listing added and modified paths](/media/landing/coding-dark.webp)

1. Expand the file list on the agent message.
2. Click **Restore files** and confirm.

That rolls those paths back to the checkpoint taken before the turn (created files are removed) and discards the conversation after the preceding user message. Manual edits on those paths are overwritten too. If later turns also touched files, those later mutations are reverted with it.

Restore is disabled while a turn is live and on a read-only sub-agent thread.

## Keep or revert when you edit a send

If you edit a user message (or retry) after later file mutations, Vixl asks **Keep files** or **Revert files**. Keep files leaves disk unchanged. Revert files rolls those paths back. Either way, the conversation after that point is discarded.
