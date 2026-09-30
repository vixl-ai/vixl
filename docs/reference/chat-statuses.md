---
title: Chat statuses
description: Sidebar and project table chat labels, what they mean, and what to do next.
---

# Chat statuses

The left sidebar and the project Chats table show a short label (or an icon with that accessible name) for each chat. Running always wins. If the chat is not running, the attention label is shown instead.

| Label | Where | Meaning | What to do |
| --- | --- | --- | --- |
| Running | Sidebar (dots) and table | A parent turn is in flight, or background sub-agents are still working after the parent finished | Wait, or [stop](/using/queue-and-stop-messages) from that chat |
| Needs approval | Sidebar and table | A tool is waiting on Allow / Deny | Open the chat and approve or deny |
| Needs input | Sidebar and table | A question card is waiting for an answer | Open the chat and answer |
| Needs MCP auth | Sidebar and table | An MCP server needs sign-in or secrets | Open the chat and complete auth |
| Done | Sidebar (dot) and table | The last turn succeeded while this chat was not the open session | Open the chat to read the result |
| Error | Sidebar and table | The last turn failed while this chat was not the open session | Open the chat to see the error |
| Idle | Project table only | Not running, and nothing needs you | Nothing. The sidebar shows no extra label for this state |

New chats start idle. Stop sets the chat idle. A successful turn on the open chat clears Done. An error on the open chat does not set the Error label (the thread already shows the failure).

Compacting is an in-thread state, not a sidebar status. Nested agents in the thread show running, done, stopped, or error. Stop on a sub-agent route stops that helper only. Stop on the parent stops every nested agent for the chat.

MCP connection states (`connected`, `starting`, `stopped`, `error`, `auth_required`, `refreshing`) are server statuses, not chat statuses. See [mcp.json](/reference/mcp-json).

See [Manage chats](/using/manage-chats) for rename, pin, fork, and delete.
