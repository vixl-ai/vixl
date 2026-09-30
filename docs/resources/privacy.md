---
title: Privacy
description: What Vixl sends over the network, what it stores locally, how deletion works, and that provider retention is the provider's business.
---

# Privacy

Vixl is local-first. There is no Vixl account, no Vixl home server, and no analytics in the app. The only telemetry-related string in the codebase is `CODEGRAPH_TELEMETRY=0`, which disables the [`@colbymchenry/codegraph`](https://www.npmjs.com/package/@colbymchenry/codegraph) package's own telemetry.

## Network

Vixl talks to the network for the things you configure, plus a few managed downloads the desktop app needs to run:

- Model providers you add (catalog hosts, custom OpenAI-compatible endpoints, [Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/)). Requests go from the local app to that host. Keys are not sent to Vixl.
- MCP servers you add (stdio children, HTTP, SSE), including browser OAuth when you log a server in.
- Agent `web_fetch` when you allow a tool call that fetches a URL.
- App updates from [GitHub Releases](https://github.com/vixl-ai/vixl/releases): `https://github.com/vixl-ai/vixl/releases/latest/download/latest.json`.
- Language servers, when `lsp.autoDownload` is on (the default) or you install one: npm packages, GitHub Release assets, HTTP archives, and `go install`. See [Language servers](/customize/language-servers).
- A portable Node.js runtime from `https://nodejs.org/dist/` if no system `node` is on PATH (used for `npx` and npm-based language servers).
- CodeGraph via `npx -y @colbymchenry/codegraph` (the npm registry). Vixl also sets `CODEGRAPH_NO_UPDATE_CHECK=1` so that package does not check for its own updates.
- The public model catalog at `https://models.dev/api.json` (no keys).

The updater is the [Tauri](https://v2.tauri.app/) updater plugin. It is skipped in dev and outside Tauri. A silent check runs on app mount. Manual check is Settings > General.

## Secrets

API keys and MCP secrets are stored in the OS keychain. They are never written to `settings.json` or `mcp.json`. Linux without Secret Service falls back to a local vault file. Details are on [Providers](/customize/providers).

## What is stored locally

Personal config is `{appData}/.vixl`. Project config is `<repo>/.vixl`. Chats, messages, and related rows live in `vixl.sqlite` under the personal directory. Each chat also has a directory at `.vixl/chats/<projectSlug>/<chatId>/`. Code graph indexes live under personal `.vixl/graphs/`. Paths are listed on [.vixl layout](/reference/vixl-layout).

## Delete means delete

Deleting a chat removes it from the client: the SQLite row (messages and related rows cascade) and the chat directory. There is no archive, no Vixl memory, and no user profiling.

If you used a cloud provider, that provider's data policies are the provider's business. Delete covers Vixl only.

Removing a project from the sidebar drops the fleet registry row. It does not delete `<repo>/.vixl`, chats, or graph indexes. Graph stores can be deleted from Settings > Graphs.

See [Manage chats](/using/manage-chats) for how to delete a chat.
