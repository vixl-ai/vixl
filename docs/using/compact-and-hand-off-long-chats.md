---
title: Compact and hand off long chats
description: Compact a long Vixl chat into a checkpoint, or Handoff to a new thread with the summary after compacting first.
---

# Compact and hand off long chats

The titlebar usage ring (beside the [code graph](/concepts/code-graphs) chip) opens a popover titled Estimated context window. Compact and Handoff live there. Both need a loaded chat. Both refuse while the parent is streaming or submitted. Stop the run first. Compact is disabled while a compaction is already running.

## Compact

Compact summarizes history into a checkpoint stored on chat meta as `activeContext` (`checkpointLineId`, `includeFromCreatedAt`, `summary`). Later turns send that summary plus the window after the checkpoint, not the full transcript.

The compact prompt asks for Goal, Decisions, Files+symbols, Errors+fixes, Skills loaded, Plan+todos, Next. Budget: 8000 tokens of active window, 2048 max output tokens.

The thread shows Compacting, then Compacted. If the model rewrite errors, Vixl still writes a deterministic fallback checkpoint and the compact succeeds. Empty history is a no-op. Other failures abort. Compaction needs a project root.

1. Open Estimated context window.
2. Click Compact.

## Handoff

Handoff runs Compact first, then writes a temp markdown file under the OS temp dir (`vixl/handoffs/handoff-<timestamp>.md`). The file starts with `# Handoff: {datetime}`, then `**Source chat:**`, then `## Summary`. It then creates a new chat titled `Handoff from <title>` in the same mode and model, and parks a first message: Continuing from handoff: plus the summary.

The original chat keeps its Compacted marker. Vixl opens the new chat.

1. Open Estimated context window.
2. Click Handoff.

Compact failures abort the handoff. A write failure after a successful compact leaves the original chat compacted. A create-chat failure leaves the original compacted and does not open a new chat.

[Export a transcript](/using/export-a-transcript)
