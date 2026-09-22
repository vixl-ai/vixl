---
title: Use the workbench
description: The Vixl workbench is the right sidebar with a Monaco editor, file tree, language servers, terminals, and git Changes.
---

# Use the workbench

The right sidebar is the workbench. Toggle it with Cmd/Ctrl+Shift+B.

The plus menu (New tab) offers Editor, Terminal, and Changes. Changes is disabled until a [project](/concepts/projects-and-home-chats) is active. Plan tabs and agent-shell tabs open from chats and from Settings lists, not from that plus menu.

Tabs persist in [SQLite](https://www.sqlite.org) (debounced). Terminal PTY session ids are not persisted; the PTY dies with the tab.

## Editor

Editor tabs host the [Monaco Editor](https://microsoft.github.io/monaco-editor/). An editor can hold several `openPaths`. Project row Open Editor opens `README.md`. Graph nodes, skills, agents, rules, and file-tree clicks open at a path. Markdown can preview. Git diffs from Changes open a read-only side-by-side diff.

Cmd/Ctrl+S saves the active Monaco buffer. Cmd/Ctrl+Shift+F opens Find and replace. Cmd/Ctrl+Shift+H opens the same pane with replace expanded. Search files is the file picker. Toggle file list shows the tree. The tree toolbar has New file and New folder. The tree menu has Rename, Cut, Copy, Paste, Add file to chat, Add file to new chat, Open in terminal, Copy relative path, Copy path, Copy name, Reveal in Finder, Open in editor, and Delete.

Language servers are configured in Settings > LSP. The status chip is on the editor tab. See [Language servers](/customize/language-servers).

Dirty close asks before discarding.

## Terminals

Terminal is a real interactive PTY via [xterm.js](https://xtermjs.org), not the agent's `run_terminal` tool. Shell is `$SHELL` or `/bin/zsh` (Windows `COMSPEC` / `cmd.exe`). Cwd is the project root, or a folder from Open in terminal. Font: [JetBrains Mono](https://www.jetbrains.com/lp/mono/) 13.

A terminal needs a project root and a PTY that can spawn.

## Changes

See [Review and restore changes](/using/review-and-restore-changes). Plus menu Changes. Branch name, porcelain status, search, click to diff.

## Plan tabs

`create_plan`, Settings > Plans, and the project Plans tab open `.vixl/plans/<id>/PLAN.md` as a plan tab. Header: Orchestrate, Build. Body: todos, markdown, [mermaid](https://mermaid.js.org). See [Work with plans](/using/work-with-plans).

## Agent shells

When the agent runs `run_terminal`, Vixl opens an agent-shell tab. That view is captured stdout/stderr plus Stop terminal. It is not a PTY.

[Shortcuts and the command palette](/using/shortcuts-and-the-command-palette)
