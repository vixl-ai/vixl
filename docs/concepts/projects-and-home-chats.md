---
title: Projects and home chats
description: A Vixl project is a folder you register; home chats run with no project using your user home as the workspace.
---

# Projects and home chats

A project is a folder you registered. Vixl does not invent a project from the current working directory. The fleet lives in personal `.vixl` as `projects.json` and `active-project.json`. Paths are on [.vixl layout](/reference/vixl-layout).

Slugs are lowercase alphanumeric plus hyphens, unique in the fleet, and never `_home_` (reserved for home chats). Duplicate folder names get `-2`, `-3`, and so on. Adding a folder that is already registered makes it active instead of inserting a second row.

## Add and remove

[Add a project](/getting-started/add-a-project) from the sidebar. A native folder picker runs. Cancel is silent. A new folder appears in the sidebar. A folder that is already registered becomes active.

Adding a folder does not create `<repo>/.vixl`. That directory appears when something first writes config (MCP, settings, a skill, and so on).

Remove from sidebar drops the fleet row. If it was active, nothing is selected. The repo `.vixl`, chats, and graph indexes stay. Graphs can be deleted later in Settings.

## Home chats vs project chats

The home composer can send into a registered project or with **No project**. A project send creates a project chat. **No project** creates a home chat.

Home chats use slug `_home_` and your user home directory as the workspace. They see personal [MCP](https://modelcontextprotocol.io/), vendored command skills, personal skills and agents, and skills and agents under that home workspace `.vixl`, plus personal `AGENTS.md`. They do not inject rules. File `@` search has no workspace on a home chat.

Project chats use that folder as the workspace. They merge personal and project config (project wins for most keys). They inject project `AGENTS.md` and project `.vixl/rules`, not the personal copies. See [The .vixl directory](/concepts/the-vixl-directory) for the merge, and [Context](/concepts/context) for what actually lands in the prompt.

The sidebar lists collapsible project rows plus a **Home** folder when home chats exist. **New Agent** goes to `/` and does not pick a project for you. The home picker does.

## Project page

Open a project from the sidebar to its page. Tabs, in order: Chats, MCP, Graph, Plans, Skills, Agents, Rules. These reuse the Settings section components with project scope. Personal copies of the same surfaces live under Settings.

Activating a project prefetches default [language servers](/customize/language-servers) and starts the [code graph](/concepts/code-graphs). Starting a new Agent-mode chat from the project row needs a Default or Agent model in Settings.

[Use the workbench](/using/use-the-workbench) for the editor, terminals, Changes, and plan tabs. [Manage chats](/using/manage-chats) covers pin, fork, rename, and delete.
