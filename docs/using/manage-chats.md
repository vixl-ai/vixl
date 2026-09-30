---
title: Manage chats
description: Rename, pin, fork, or delete chats from the sidebar, and copy an id or export a transcript from the thread.
---

# Manage chats

Chats live in the left sidebar, grouped under each [project](/concepts/projects-and-home-chats). Home chats sit under **Home**. Click a row to open it. Right-click a sidebar row to rename, fork, pin or unpin, or delete. Right-click the open thread for **Copy ID**, **Export Transcript**, rename, and pin or unpin. Fork and delete are sidebar-only.

Sidebar status icons (running, needs approval, and the rest) are on [Chat statuses](/reference/chat-statuses).

## Rename a chat

New chats start titled **New Agent**. If [Auto-title](/customize/models) is on (the default), a title job can replace that after the first message. Rename overwrites whatever is there.

1. Right-click the chat in the sidebar or on the thread.
2. Choose **Rename**.
3. Type the new title and save.

## Pin a chat

Pin a chat you want to find quickly. Pinned chats also appear under **Pinned** in the sidebar header.

1. Right-click the chat in the sidebar or on the thread.
2. Choose **Pin**. Choose **Unpin** from the same menu when you no longer want it pinned.

## Fork a chat

Fork when you want a copy of the thread (messages and file checkpoints) so you can try a different direction without losing the original. The new chat is titled `<title> (fork)`, starts idle, and is not auto-titled. Vixl opens the fork.

1. Right-click the chat in the sidebar.
2. Choose **Fork**.

## Delete a chat

::: warning
Delete is permanent. There is no archive. See [Privacy](/resources/privacy) for what delete removes on the client, and what it does not cover at a cloud provider.
:::

1. Right-click the chat in the sidebar.
2. Choose **Delete** and confirm.

If that chat was open, Vixl goes Home. The open run, plan session, and agent shells for that chat are stopped first.

The project **Chats** table can rename and delete the same way. It does not fork or pin.

Next, [queue and stop messages](/using/queue-and-stop-messages), or [export a transcript](/using/export-a-transcript) from the thread menu.
