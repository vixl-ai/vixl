---
title: Privacy
description: Vixl is local-first with no analytics and no home server; you configure providers and MCP, and keys stay in the OS keychain.
---

# Privacy

Vixl is local-first. There is no analytics in the app and no round trip to a Vixl home server. The only telemetry-related string in the codebase is `CODEGRAPH_TELEMETRY=0`, which disables the [`@colbymchenry/codegraph`](https://www.npmjs.com/package/@colbymchenry/codegraph) package's own telemetry.

## Network

The only network calls are the ones you configure:

- Model providers you add (catalog hosts, custom OpenAI-compatible endpoints, [Ollama](https://ollama.com/), [LM Studio](https://lmstudio.ai/))
- MCP servers you add (stdio children, HTTP, SSE)
- App updates from [GitHub Releases](https://github.com/vixl-ai/vixl/releases): `https://github.com/vixl-ai/vixl/releases/latest/download/latest.json`

The updater is the [Tauri](https://v2.tauri.app/) updater plugin. It is skipped in dev and outside Tauri. A silent check runs on app mount. Manual check is Settings > General.

## Secrets

API keys and MCP secrets are stored in the OS keychain (service `vixl`). They are never written to `settings.json` or `mcp.json`. Linux without Secret Service uses `secrets-vault.json` in the app config dir, mode `0600`.

## Delete means delete

Deleting a chat removes it from the client: the SQLite `chats` row (messages and related rows cascade) and the directory `.vixl/chats/<projectSlug>/<chatId>/`. There is no archive, no Vixl memory, and no user profiling.

If you used a cloud provider, that provider's data policies are the provider's business. Delete covers Vixl only.

Removing a project from the sidebar drops the fleet registry row. It does not delete `<repo>/.vixl`, chats, or graph indexes. Graph stores can be deleted from Settings > Graphs.

See [Manage chats](/using/manage-chats), [FAQ](/resources/faq), and [.vixl layout](/reference/vixl-layout).
