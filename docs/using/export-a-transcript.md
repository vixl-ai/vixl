---
title: Export a transcript
description: Save a chat as a plain-text transcript from the thread menu; Copy ID copies the chat id, not the dump.
---

# Export a transcript

Export when you want a readable copy of the current thread outside Vixl (notes, review, or another tool). Right-click the thread (not the sidebar row) and choose **Export Transcript**.

Vixl builds a plain-text dump of the current timeline and opens a native save dialog. The default filename is the chat title with a `.txt` suffix. The filter is Text, with `txt` and `md`. Pick a path. Cancel writes nothing.

Turns are labeled:

- `USER`
- `ASSISTANT` (reasoning, text, tool runs, trailing text). A finished turn ends with `stopped: <reason>`, plus an optional detail.
- `TODO` (in-chat task list)
- `SUBAGENT` (name, status, prompt, nested tools, steers, summary). A finished sub-agent ends with `stopped: <reason>` after `summary:` when that line is present, plus an optional detail.
- `COMPACTION` (summary, optional focus)

Reasons are `completed`, `output-limit`, `content-filter`, `user-stop`, `timeout`, `error`, `failed`, `aborted`, `compaction`, and `incomplete`. A run still in progress, and an older chat saved before this feature, has no line.

An empty thread exports `(empty conversation)`.

**Copy ID** on the same menu copies the chat id to the clipboard. It is not a transcript.

See [Manage chats](/using/manage-chats) for rename, pin, fork, and delete.
