---
title: Code graphs
description: Vixl indexes each project with CodeGraph via npx, stores graphs under personal .vixl, and exposes them as MCP tools.
---

# Code graphs

Vixl indexes each project with [`@colbymchenry/codegraph`](https://www.npmjs.com/package/@colbymchenry/codegraph), run via `npx`. Indexes live under personal `.vixl/graphs/`, never in the repo. The package's own telemetry is off: every CLI and MCP spawn sets `CODEGRAPH_TELEMETRY=0` (and `CODEGRAPH_NO_UPDATE_CHECK=1`).

This is a managed install. Source: that npm package. See [Managed components](/reference/managed-components).

## Init and index

On project activate, if the graph database is missing, Vixl runs `npx -y @colbymchenry/codegraph init` against the project root. Rebuild from the Graph tab runs `index` with `--force`.

The store directory is under personal `.vixl/graphs/`, keyed by the SHA-256 of the canonical absolute project root (`codegraph.db` plus a Node preload so the database is not written into the repo). An in-repo `.codegraph` folder is treated as leftover and cleaned after CLI.

Vixl strips any user `codegraph` entry from personal and project `mcp.json` and starts an in-memory stdio [MCP](https://modelcontextprotocol.io/) server instead: `npx -y @colbymchenry/codegraph serve --mcp --path {root}`, with session trust. It does not appear in the chat MCP picker or Settings MCP list.

## What the agent gets

Allowed MCP tools on that server: `explore`, `node`, `search`, `callers`, `callees`, `impact`, `files`, `status`.

The agent calls `codebase_explore` for architecture, flows, and where-is-X (`codegraph_explore`), `codebase_search` for symbol names and locations (`codegraph_search`), `codebase_impact` for blast radius (`codegraph_impact`), and `codebase_status` for index health (`codegraph_status`).

Shared tool guidance tells the agent to prefer those for structure, then fall back to [LSP](https://microsoft.github.io/language-server-protocol/), grep, or `read_file` if the index is not ready. All four [chat modes](/concepts/chat-modes) include the `codebase_*` tools.

If a codebase mention is present on send, and the graph is connected with enough free context, Vixl may prefetch `codegraph_explore` into that mention. Prefetch failure still sends.

## Graph tab and Settings

The project **Graph** tab shows index status and stats, and lets you search symbols or files and rebuild the index. Click a node to open that file at the line in the [workbench](/using/use-the-workbench). Rebuild needs an open project with a running graph.

Settings > Graphs lists stores by name and size, can reveal the folder, and can delete an index (the project stays in the sidebar).

[Add a project](/getting-started/add-a-project) if you do not have one yet. Graph start is part of activating the project.
