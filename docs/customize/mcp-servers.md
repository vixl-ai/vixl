---
title: MCP servers
description: Add MCP servers in Vixl over stdio, HTTP, or SSE; config lives in mcp.json and secrets stay in the OS keychain.
---

# MCP servers

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) servers expose tools the agent can call. Add servers from Settings > MCP or the project MCP tab with the Add server dialog. Vixl speaks stdio, HTTP, and SSE. Config is `mcp.json`. Secrets stay in the OS keychain. Trust is a fingerprint of the command plus args for stdio, or of the type plus URL for HTTP and SSE.

## Personal vs project

- Settings > MCP writes the personal `{appData}/.vixl/mcp.json`.
- A project's MCP tab writes `<repo>/.vixl/mcp.json`.

Same component, different `mcp.json`. A project server with the same id replaces the personal one (scope `overridden`). Inputs merge by id; project wins. The managed CodeGraph server id `codegraph` is stripped from user lists and is not in the chat picker.

Home chats with **No project** only see personal servers. Project chats see the merged set. The chat MCP picker toggles `enabled` on the existing personal or project entry. There is no per-chat MCP list in SQLite.

Header: Refresh all (when any exist), Add server.

## Add a server

1. Open Settings > MCP, or a project MCP tab.
2. Open Add server.
3. Set Server ID and Transport (`stdio`, `http`, or `sse`).
4. Fill the transport fields.
5. Save.

Save writes that scope's `mcp.json` and any new secrets to the keychain.

### stdio

Command defaults to `npx`. Copy: "PATH basename only (for example npx, uvx, or docker). Review before trusting." Absolute filesystem paths are rejected.

Allowed basenames: `npx`, `npm`, `node`, `pnpm`, `yarn`, `bun`, `bunx`, `deno`, `uvx`, `uv`, `python`, `python3`, `pipx`, `codegraph`, `docker`, `podman`, `nerdctl`.

Args are comma-separated. Env rows become `${input:KEY}` secrets. Stdio is a [Tauri](https://tauri.app) child process: JSON-RPC over stdin/stdout. Project servers start in that connection's project folder, even when Vixl itself was started somewhere else, so relative args resolve against the repo. Personal servers do not.

### http and sse

URL is required and may include `${input:...}` and `${env:...}` templates. Templates are replaced with a placeholder, then the result must parse as a URL. `https` is allowed. `http` is allowed only on `localhost`, `127.0.0.1`, or `::1`.

`auth` is optional and one of `"none"`, `"headers"`, or `"oauth"`:

| Mode | When to use |
| --- | --- |
| `none` | Public server. Set `auth` to `"none"` explicitly. No OAuth block. |
| `headers` | Static header auth, for example a bearer token. `headers` must be present and non-empty. |
| `oauth` | Browser OAuth for this HTTP or SSE server. |

If `auth` is omitted, Vixl infers it: a non-empty `headers` object means header auth; an `oauth` block or neither field means OAuth. Use explicit `"none"` for public servers. Stdio servers are always none.

Header rows are secrets. Bearer token example: set `auth` to `"headers"` and `Authorization` to `Bearer ${input:Authorization}`.

Optional **OAuth client ID** (blank means dynamic registration). Optional **OAuth client secret** as `${input:...}` (never plaintext). Optional **scopes**. Optional **callback port** (positive integer). Optional **authorization server metadata URL**. Optional **Allowed authorization servers**, one origin URL per line; if empty, you confirm the origin on first login.

HTTP and SSE run in the [Vue](https://vuejs.org) process via [`@ai-sdk/mcp`](https://www.npmjs.com/package/@ai-sdk/mcp) ([AI SDK](https://ai-sdk.dev)).

## Trust fingerprints

Start or enable may open **Trust MCP server?** Untrusted servers cannot start or be called. Changing command, args, URL, or HTTP vs SSE changes the fingerprint, so trust is required again.

**This session** stays in memory. **This workspace** writes project `settings.json` `agent.mcp.trust[]` with `scope: "workspace"` (falls back to personal `always` if there is no project). **Always** writes personal `agent.mcp.trust[]` with `scope: "always"`. **Never** writes personal `scope: "never"` and blocks start. Personal `never` wins over project on merge.

The dialog warns that the server can run code on your machine (for example via npx or uvx). Agent error if untrusted: the server has not been granted trust; open Settings, MCP, and start it.

Trust does not skip [permission](/concepts/permissions-and-approvals) gates. `mcp.call` still goes through Ask / Allowlist / Bypass.

## Keychain secrets

Declared inputs store as `vixl:mcp:{serverId}:input:{inputId}`. Header, env, and HTTP URL values use `${input:id}` templates. `${env:NAME}` is also substituted. Missing input at start sets status `auth_required:inputs`.

A key icon opens the secrets form on servers that declare inputs. Badge: **Secrets configured**.

OAuth material uses `vixl:mcp:{serverId}:oauth:` plus `tokens`, `verifier`, `client`, `state`, `as`, `static`.

## OAuth (HTTP and SSE)

1. Start the server.
2. Grant trust if asked.
3. Use **Log in** when status is `auth_required`.
4. Confirm the authorization-server origin if prompted (**Confirm authorization server**).
5. Complete browser OAuth. Tokens land in the keychain. Badge: **OAuth connected**.

**Log out** clears secrets and the HTTP session. **Cancel sign in** aborts. In chat, auth can surface as an MCP auth card.

## How agents see MCP

Enabled servers and their tools are listed in the system prompt. Modes that include `get_mcp_tools` / `get_mcp_tool` get the catalog (Ask, Plan, Agent, Orchestrator). `call_mcp_tool` takes `{ serverId, tool, args }`, checks trust, then the `mcp.call` permission gate.

Statuses: `connected`, `starting`, `stopped`, `error`, `auth_required`, `refreshing`. Per-row actions: expand tools, Edit, Edit secrets, Refresh/Start, Start/Stop, Log in/out, Cancel sign-in, Delete.

Full file shape: [mcp.json](/reference/mcp-json). Layout: [`.vixl` layout](/reference/vixl-layout).
