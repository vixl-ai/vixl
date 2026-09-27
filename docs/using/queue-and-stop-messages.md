---
title: Queue and stop messages
description: When the Vixl parent is busy, a send is queued; Stop generating aborts the run and does not drain the queue.
---

# Queue and stop messages

The [chat input](/getting-started/your-first-chat) sends on Enter. Shift+Enter splits a line. Placeholder: `@ for context, / for commands`.

## When a send is queued

If the parent is busy, a send does not start a second turn. It is enqueued. Busy means the parent is streaming or submitted, a compaction is running, or a background-subagent resume is in flight.

A pill shows `N queued` (for example `2 queued`). Open it to see the stack. Each item has a text preview and any attachments.

Edit puts the text and restorable attachments back in the chat input and removes the item from the queue. Attachments that cannot be restored are dropped.

Send now (stops running work) aborts the parent, stops subagents for the chat, kills agent shells, then sends that item.

Remove drops the item.

After a turn finishes normally, Vixl sends the next queued item. Stop generating sets a flag so the queue is not drained automatically. You send the rest yourself, or you use Send now (stops running work).

If an `ask_user` question is pending, a non-empty send from the chat input is the answer, not a new turn and not a queued message.

Send is blocked until the chat is ready, a model is selected, a provider is configured, settings have loaded, and the input is non-empty.

## Stop a run

While the parent is submitted or streaming, or while it is waiting on background subagents, the send control is replaced by Stop generating (square).

Stop generating aborts the parent, rejects pending [MCP](https://modelcontextprotocol.io) auth, aborts every subagent for that chat (each is marked Stopped), sets chat status to idle, and kills agent shells for the chat.

On a subagent thread (`.../subagent/:subagentId`), Stop generating stops only that subagent. That thread keeps a send control while the parent is busy: typing there steers the subagent. It does not enqueue on the parent. See [Orchestrate sub-agents](/using/orchestrate-sub-agents).

[Compact and hand off long chats](/using/compact-and-hand-off-long-chats)
