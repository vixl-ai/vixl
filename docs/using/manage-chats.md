---
title: Manage chats
description: Manage Vixl chats in the sidebar by renaming, pinning, forking, deleting, copying the id, or exporting a transcript.
---

# Manage chats

Chats live in the left sidebar, grouped under each [project](/concepts/projects-and-home-chats). Home chats sit at the top level. Click a row to open it.

Right-click a sidebar chat for Rename, Fork, Pin or Unpin, and Delete. Right-click the thread for Copy ID, Export Transcript, Rename, and Pin or Unpin. Fork and Delete are sidebar-only.

## Rename a chat

New chats start titled New Agent. If `chat.autoTitle` is on (the default), a title job can replace that after the first message. Rename overwrites whatever is there.

1. Right-click the chat in the sidebar.
2. Choose Rename.
3. Type the new title.
4. Click Save.

The dialog is titled Rename chat. Cancel leaves the title unchanged. You can rename from the thread menu the same way.

## Pin a chat

Pin stores `pinned` and `pinned_at` on the chat row in [SQLite](https://www.sqlite.org). Pinned chats also appear under Pinned in the sidebar header.

1. Right-click the chat.
2. Choose Pin.

Unpin is the same menu once the chat is pinned.

## Fork a chat

Fork copies the messages and file checkpoints into a new chat. The title becomes `<title> (fork)`. The new row records `forked_from` as the source id. Status is idle. The fork is not auto-renamed.

1. Right-click the chat.
2. Choose Fork.

Vixl opens the fork.

## Delete a chat

Delete means delete. There is no archive, no memory, and no user profiling. Removing a chat drops the [SQLite](https://www.sqlite.org) row (messages and usage cascade with it) and removes the chat directory under the personal [`.vixl`](/concepts/the-vixl-directory) tree: `{app data}/.vixl/chats/<projectSlug>/<chatId>/` (macOS: `~/Library/Application Support/app.vixl/.vixl/chats/`). File checkpoints live in that directory, so they go with it. The open harness, plan session, and agent shells for that chat are torn down first.

If a [cloud provider](/customize/providers) was used, that provider's data policies are the provider's business. Delete covers Vixl only. See [Privacy](/resources/privacy).

1. Right-click the chat.
2. Choose Delete.
3. Click Delete.

The dialog is titled Delete chat?. It warns that the title and its message history are permanently deleted. Cancel aborts. If that chat was open, Vixl routes Home.

The project Chats table can Rename and Delete the same way. It does not Fork or Pin.

Sidebar status chrome (Running, Needs approval, Needs input, Needs MCP auth, Done, Error) is documented under [Chat statuses](/reference/chat-statuses).

[Queue and stop messages](/using/queue-and-stop-messages)
