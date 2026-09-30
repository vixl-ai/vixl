---
title: Compact and hand off long chats
description: Compact a long chat into a summary checkpoint, or hand off that summary to a new thread.
---

# Compact and hand off long chats

As a thread grows, later turns send more history and cost more. Compact replaces older turns with a summary checkpoint so the next send uses that summary plus the messages after it. Handoff does the same compact, then starts a new chat with that summary so you can continue without carrying the full transcript.

Both live in the titlebar usage ring (beside the [code graph](/concepts/code-graphs) chip). Open it for the estimated context window. Both need a loaded chat with a project root. Both are disabled while the parent is streaming or submitted. Stop the run first. Compact is also disabled while a compaction is already running.

## Compact

1. Open the usage ring.
2. Click **Compact**.

The thread shows **Compacting**, then **Compacted**. Later turns send the checkpoint summary plus the window after it, not the full transcript.

If the rewrite fails, Vixl still writes a deterministic fallback summary and compact succeeds. An empty thread fails with nothing to compact. If even the fallback will not fit the model window, compact fails and the chat is unchanged.

## Handoff

1. Open the usage ring.
2. Click **Handoff**.

Handoff runs Compact first, then creates a new chat titled `Handoff from <title>` in the same mode and model, and sends a first message: `Continuing from handoff:` plus the summary. The original chat keeps its **Compacted** marker. Vixl opens the new chat.

Compact failures stop the handoff. A failure after a successful compact leaves the original chat compacted and does not open a new chat.

Next, [export a transcript](/using/export-a-transcript) if you want a copy of the current thread on disk.
