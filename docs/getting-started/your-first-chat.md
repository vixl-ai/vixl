---
title: Your first chat
description: Send a first Vixl chat from the home screen after you pick a project, a mode, and a BYOK model.
---

# Your first chat

First launch opens the home screen: a chat input in the main pane. **New Agent** in the sidebar, or `Cmd/Ctrl+N`, returns here. You need a [provider and a model](/getting-started/set-up-providers-and-models) before you can send. With no provider, the model picker is disabled.

## Send from home

1. Click **New Agent** if you are not already on home.
2. Select a project, or leave **No project**. The picker defaults to the last active project.
3. Choose a mode. The default is **Agent**.
4. Choose a model if one is not already filled from your Default role.
5. Type a message and send. Enter sends. Shift-Enter inserts a new line.

**No project** creates a [home chat](/concepts/projects-and-home-chats) whose workspace is your user home directory. A selected project creates a project chat and opens that thread. New chats are titled **New Agent** until Auto-title fills one in (on by default).

The plus menu attaches images. The shield under the input is the [permission dial](/concepts/permissions-and-approvals) (default **Allowlist**). On a git workspace, a branch control appears next to it. The MCP control lists configured servers. Skills and custom agents are `/` in the editor.

## Modes

**Agent** implements changes in this chat. **Ask** is read-only exploration. **Plan** researches, then writes a durable `PLAN.md`. **Orchestrator** coordinates work through sub-agents. Tool allowlists live on [Chat modes](/concepts/chat-modes).

## After you send

The thread opens and the first message is sent.

![A Vixl chat thread with the composer at the bottom and an empty workbench](/features/harness.png)

The agent can read the workspace, call tools the mode allows, and ask before actions the permission dial does not already allow. The [workbench](/using/use-the-workbench) is the right-side panel: editor, terminals, git Changes, and plan tabs. While a reply is running, send becomes **Stop generating**.

To rename, pin, fork, or delete a thread, see [Manage chats](/using/manage-chats). Delete is permanent. See [Philosophy](/getting-started/philosophy).
