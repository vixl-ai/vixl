---
title: Projects and home chats
description: A Vixl project is a folder you register; home chats run with no project using your user home as the workspace.
---

# Projects and home chats

A project is a folder you registered. Vixl does not invent a project from the current working directory. The fleet lives in personal `.vixl` as `projects.json` (id, name, slug, `root_path`, `last_opened`) and `active-project.json` (`project_id`, or null).

Slugs are lowercase alphanumeric plus hyphens, unique, and never `_home_` (reserved for home chats). Duplicate folder names get `-2`, `-3`, and so on. Duplicate canonical roots update `last_opened` instead of inserting a second row.

## Add and remove

[Add a project](/getting-started/add-a-project) from the sidebar Chats toolbar (**Add project**) or the empty-sidebar **Open Project** menu. A native folder picker runs. Cancel is silent. A new folder is added to the sidebar. A folder that is already registered becomes active.

Adding a folder does not create `<repo>/.vixl`. That directory appears when something first writes config (MCP, settings, a skill, and so on).

**Remove from sidebar** drops the row from `projects.json`. If it was active, `active-project.json` becomes null. The repo `.vixl`, chats, and graph indexes stay. Graphs can be deleted later in Settings > Graphs.

## Home chats vs project chats

The home chat input has a folder picker: **No project**, then every fleet project. Submit with a project creates a project chat and routes to `/project/:slug/chat/:id`. Submit with **No project** creates a home chat at `/chat/:id`.

Home chats use slug `_home_` and your user home directory as the workspace. They see personal [MCP](https://modelcontextprotocol.io/), vendored command skills, personal skills and agents, and skills and agents under that home workspace `.vixl`, plus personal `AGENTS.md`. They do not inject rules. File `@` search has no workspace until a project is selected.

Project chats use that folder as `projectRoot`. They merge personal and project config (project wins for most keys). They inject project `AGENTS.md` and project `.vixl/rules`, not the personal copies. See [The .vixl directory](/concepts/the-vixl-directory) for the merge.

The sidebar lists collapsible project rows mixed with a **Home** folder for home chats. Rows sort by recent activity; Home uses its newest chat. Home is hidden when it has no chats, or when search or the running-only filter leaves none. Search text matching **home** shows all home chats. Home opens when you are viewing a home chat, and follows Collapse All / Expand All. Its plus button starts a new home chat (same as sidebar **New Chat**). Home has no project context menu. **New Agent** goes to `/` and does not pick a project for you. The home picker does.

## Project page tabs

Open a project from the sidebar to `/project/:slug`. Tabs, in order: Chats, MCP, Graph, Plans, Skills, Agents, Rules. These reuse the Settings section components with project scope. Personal copies of the same surfaces live under Settings (General, Graphs, MCP, Providers, Models, LSP, Permissions, Plans, Skills, Agents, Rules).

Escape on the project page goes home. An unknown slug redirects home. Activating a project prefetches default [language servers](/customize/language-servers) and starts the [code graph](/concepts/code-graphs).

The project row plus button starts a new Agent-mode chat in that project. That is blocked until a Default (or Agent) model is set in Settings. Context menu also has **Open Editor** (`README.md` in the workbench) and **Open Terminal**.

[Use the workbench](/using/use-the-workbench) for the editor, terminals, Changes, and plan tabs. [Manage chats](/using/manage-chats) covers pin, fork, rename, and delete.
