---
title: Creating a project group
description: Select two or more registered projects in the home composer so one chat can span every member root.
---

# Creating a project group

A [project group](/concepts/projects-and-home-chats) is a set of registered projects that share one chat. Register each folder first with [Add a project](/getting-started/add-a-project).

## Create from the home composer

1. Click **New Agent** so you are on the home screen.
2. Open the project picker next to the composer. It is a multiselect.
3. Pick two or more projects.
4. Type a message and send.

Vixl upserts a group for that member set. The default name is the member project names joined with commas, for example `api, web`. The group appears in the sidebar as that CSV-named row. Sending the same member set again reuses the existing group instead of adding a duplicate.

You can also pick an existing group in the picker. That starts a chat on that group without creating a new row.

## Group chats from the sidebar

The group row behaves like a project row. The plus button starts a new chat on the group. Left-click expands its chats. Open the group page from the row for chats and the same project surfaces, scoped to the group.

Group threads use `/group/<slug>/chat/<id>`. Chat files live under `chats/<groupSlug>/<chatId>/` in personal `.vixl`.

## How the agent sees the members

The first project in the group is the **primary member**. Tools that take a single root (git `repo`, `run_terminal` cwd) default to that folder. File tools need a slug prefix, for example `api/src/index.ts`. Search without a path filter covers every member.

Each member is still its own git repo. Make one commit per repo. Do not stage files across projects.

Next, [send a first chat](/getting-started/your-first-chat), or read [Projects and home chats](/concepts/projects-and-home-chats).
