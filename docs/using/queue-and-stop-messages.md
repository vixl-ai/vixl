---
title: Queue and stop messages
description: Queue a follow-up while a reply is running, or stop the run without sending the rest of the queue.
---

# Queue and stop messages

When the parent is already working, a send does not start a second turn. It waits in a queue so you can keep typing. Use **Stop generating** when you want the current run to end. That does not send the queued follow-ups for you.

Enter sends. Shift-Enter inserts a line. Send needs a loaded chat, a selected model, a configured provider, and a non-empty input (or a restorable attachment).

## When a send is queued

The parent is busy if it is streaming or submitted, a compaction is running, or a background-subagent resume is in flight. In those cases a send is enqueued.

A pill shows `N queued`. Open it for the stack: a text preview and any attachments.

- **Edit** puts the text and restorable attachments back in the chat input and removes the item. Attachments that cannot be restored are dropped.
- **Send now (stops running work)** stops the parent and any sub-agents that are blocking the turn, then sends that item. Background sub-agents keep running.
- **Remove** drops the item.

After a turn finishes normally, Vixl sends the next queued item. **Stop generating** sets a flag so the queue is not drained automatically. You send the rest yourself, or you use **Send now**.

If an `ask_user` question is pending, a non-empty send from the chat input is the answer, not a new turn and not a queued message.

## Stop a run

While the parent is submitted or streaming, or while it is waiting on background sub-agents, the send control is replaced by **Stop generating**.

**Stop generating** stops the parent, rejects pending MCP auth, stops every sub-agent for that chat (each is marked Stopped), sets the chat to idle, and stops agent shells for the chat.

On a sub-agent thread, **Stop generating** is hidden. The send control stays available while the parent is busy: typing there steers that sub-agent. It does not enqueue on the parent. See [Orchestrate sub-agents](/using/orchestrate-sub-agents).

Next, [compact or hand off](/using/compact-and-hand-off-long-chats) a long chat when the context window is filling up.
