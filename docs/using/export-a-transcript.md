---
title: Export a transcript
description: Save a chat as a plain-text transcript from the thread menu; Copy ID copies the chat id, not the dump.
---

# Export a transcript

Export when you want a readable copy of the current thread outside Vixl (notes, review, or another tool). Right-click the thread (not the sidebar row) and choose **Export Transcript**.

Vixl builds a plain-text dump of the current timeline and opens a native save dialog. The default filename is the chat title with a `.txt` suffix. The filter is Text, with `txt` and `md`. Pick a path. Cancel writes nothing.

Turns are labeled:

- `USER`
- `ASSISTANT` (reasoning, text, tool runs, trailing text, errors)
- `TODO` (in-chat task list)
- `SUBAGENT` (name, status, prompt, nested tools, steers, summary)
- `COMPACTION` (summary, optional focus)

An empty thread exports `(empty conversation)`.

**Copy ID** on the same menu copies the chat id to the clipboard. It is not a transcript.

See [Manage chats](/using/manage-chats) for rename, pin, fork, and delete.
