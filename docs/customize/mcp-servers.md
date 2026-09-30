---
title: MCP servers
description: Add MCP servers in Vixl over stdio, HTTP, or SSE. Config lives in mcp.json and secrets stay in the OS keychain.
---

# MCP servers

[MCP](https://modelcontextprotocol.io) (Model Context Protocol) servers expose tools the agent can call. You add them from Settings > MCP or a project's MCP tab. Vixl speaks stdio, HTTP, and SSE. Config is `mcp.json`. Secrets stay in the OS keychain, never in that file. The file shape is on [mcp.json](/reference/mcp-json).

## Personal vs project

Settings > MCP writes the personal `{appData}/.vixl/mcp.json`. A project's MCP tab writes `<repo>/.vixl/mcp.json`. Same UI, different file. Paths are listed on [`.vixl` layout](/reference/vixl-layout).

A project server with the same id replaces the personal one (scope `overridden`). Inputs merge by id; the project value wins. The managed CodeGraph id `codegraph` is stripped from user lists and is not in the chat picker. Do not add it here; see [Code graphs](/concepts/code-graphs).

Home chats with **No project** only see personal servers. Project chats see the merged set. The chat MCP picker toggles `enabled` on the existing personal or project entry. There is no separate per-chat MCP list.

## Add a server

1. Open Settings > MCP, or a project's MCP tab.
2. Choose **Add server**.
3. Set a server id and a transport: `stdio`, `http`, or `sse`.
4. Fill the transport fields.
5. Save. That writes this scope's `mcp.json` and any new secrets to the keychain.

### stdio

Command defaults to `npx`. It must be a PATH basename, not a filesystem path. Allowed names, env overlay rules, and `envFile` are on [mcp.json](/reference/mcp-json). Args are comma-separated in the form and stored as a list. Env rows become `${input:KEY}` secrets.

A project stdio server starts in that project's folder, even when Vixl itself was started somewhere else, so relative args resolve against the repo. If the project folder is missing, start fails. Personal servers are not given a project working directory.

### HTTP and SSE

URL is required. `auth` is `none`, `headers`, or `oauth`. Use `none` for a public server, `headers` for static header auth, and `oauth` for browser OAuth. Header rows are secrets. For a bearer token, set `auth` to `headers` and `Authorization` to `Bearer ${input:Authorization}`.

URL policy, omitted-auth inference, and OAuth object fields are on [mcp.json](/reference/mcp-json).

## Trust

Start or enable may ask you to trust the server. Untrusted servers cannot start or be called. Trust is a fingerprint of the command plus args for stdio, or of the type plus URL for HTTP and SSE. Changing those requires trust again. Header and env changes do not.

**This session** stays in memory until you quit. **This workspace** writes project `settings.json` `agent.mcp.trust[]` with `scope: "workspace"` (falls back to personal `always` if there is no project). **Always** writes personal `agent.mcp.trust[]` with `scope: "always"`. **Never** writes personal `scope: "never"` and blocks start. Personal `never` wins over a project grant on merge.

The prompt warns that the server can run code on your machine (for example via npx or uvx). If the agent calls an untrusted server, the tool error says to open Settings > MCP and start it to grant trust.

Trust does not skip [permission](/concepts/permissions-and-approvals) gates. `call_mcp_tool` still goes through Ask / Allowlist / Bypass as `mcp.call`.

## Inputs and secrets

Declared inputs and OAuth tokens store in the same OS keychain vault as provider keys. Template names and key formats are on [mcp.json](/reference/mcp-json). The vault itself is on [Providers](/customize/providers). Missing inputs at start leave the server waiting for secrets.

## OAuth

HTTP and SSE servers can use browser OAuth:

1. Start the server.
2. Grant trust if asked.
3. Use **Log in** when the server needs auth.
4. Confirm the authorization-server origin if prompted.
5. Complete OAuth in the browser. Tokens land in the keychain.

**Log out** clears secrets and the HTTP session. **Cancel sign in** stops an in-flight login. In chat, auth can surface as an MCP auth card.

## What the agent sees

Enabled servers appear in the system prompt as a catalog of names and short tool descriptions. The agent loads full schemas on demand (`get_mcp_tools` / `get_mcp_tool`), then calls `call_mcp_tool`. That is [progressive discovery](/concepts/context). Ask, Plan, Agent, and Orchestrator all include those tools.
