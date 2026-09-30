---
title: Review and restore changes
description: Review git working-tree diffs in the workbench, or restore files from a per-turn checkpoint on an agent message.
---

# Review and restore changes

Two surfaces show what changed: the workbench **Changes** tab (the git working tree) and the per-turn file list on an agent message (Vixl file checkpoints). They are not the same thing. Use **Changes** to inspect uncommitted git status. Use restore on a turn when you want those paths rolled back to the checkpoint taken before that message.

Git tools and git neutrality (the agent does not commit unless you ask) are on [Chat modes](/concepts/chat-modes).

## Git Changes tab

Open the workbench plus menu and choose **Changes**. It needs an active [project](/concepts/projects-and-home-chats) with a git repository.

The tab lists **Local** and the current branch. Ignored files are hidden. Search filters paths. Click a row to open a read-only side-by-side diff. The tab refreshes when it is focused and when git HEAD changes.

Status letters on rows and in the file tree: Added, Untracked, Modified, Deleted, Renamed, Conflicted.

See [Use the workbench](/using/use-the-workbench) for how tabs open.

## Restore files from a turn

Before the agent mutates a file, Vixl captures a baseline keyed to the user message that started that turn. After a turn that changed files, the thread shows a count such as `3 files changed`. Expand it for paths.

![Agent reply with three files changed expanded, listing added and modified paths](/media/landing/coding-dark.webp)

1. Expand the file list on the agent message.
2. Click **Restore files** and confirm.

That rolls those paths back to the checkpoint taken before the turn (created files are removed) and discards the conversation after the preceding user message. Manual edits on those paths are overwritten too. If later turns also touched files, those later mutations are reverted with it.

Restore is disabled while a turn is live and on a read-only sub-agent thread.

## Keep or revert when you edit a send

If you edit a user message (or retry) after later file mutations, Vixl asks **Keep files** or **Revert files**. Keep files leaves disk unchanged. Revert files rolls those paths back. Either way, the conversation after that point is discarded.
