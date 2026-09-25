---
title: mcp.json
description: mcp.json holds Vixl MCP server configs for personal and project scope; secrets stay in the OS keychain, not this file.
---

# mcp.json

MCP ([Model Context Protocol](https://modelcontextprotocol.io/)) server configs live in `mcp.json`. Personal file: `{appData}/.vixl/mcp.json`. Project file: `<repo>/.vixl/mcp.json`. Secrets are not written here. They go in the OS keychain. See [MCP servers](/customize/mcp-servers).

Read and write go through `read_mcp_config` / `write_mcp_config`. A missing file is an empty config (`{ "servers": {} }`). Invalid server entries are dropped. If every server fails to parse, load errors with `MCP config servers failed to parse` and migrate falls back to empty.

## Config shape

```json
{
  "servers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${input:GITHUB_TOKEN}" },
      "enabled": true
    },
    "docs": {
      "type": "http",
      "url": "https://example.com/mcp",
      "auth": "headers",
      "headers": { "Authorization": "Bearer ${input:Authorization}" },
      "enabled": true
    }
  },
  "inputs": [
    {
      "id": "GITHUB_TOKEN",
      "type": "promptString",
      "description": "GITHUB_TOKEN",
      "password": true
    }
  ]
}
```

`servers` is required. `inputs` is optional.

Project `servers[id]` replaces personal `servers[id]` (scope `overridden`). Inputs merge by `id`. Project wins on the same id. The reserved id `codegraph` is stripped from user lists. Vixl starts CodeGraph in memory. Do not add it here. See [Code graphs](/concepts/code-graphs).

`enabled: false` turns a server off. Missing `enabled` is on.

## Stdio servers

A stdio server has `command` (required) plus optional `args`, `env`, `envFile`, and `enabled`. There is no `type` field.

`command` must be a PATH basename, not a filesystem path. Allowed names: `npx`, `npm`, `node`, `pnpm`, `yarn`, `bun`, `bunx`, `deno`, `uvx`, `uv`, `python`, `python3`, `pipx`, `codegraph`, `docker`, `podman`, `nerdctl`. Typical forms: `npx -y <pkg>`, `uvx <pkg>`, or `docker run`.

Stdio is a [Tauri](https://v2.tauri.app/) child process over stdin/stdout. It does not use the JS MCP SDK. A project stdio server starts in that project's folder, not the directory Vixl was launched from. Relative args such as `server/mcp/index.ts` resolve against `<repo>`. If the project folder is missing, start fails instead of waiting on a handshake. Personal servers are not given a project working directory. There is no `cwd` field.

## HTTP and SSE servers

HTTP and SSE servers set `type` to `"http"` or `"sse"` and require `url`. `url` may include `${input:id}` and `${env:NAME}` templates. Templates are replaced with a placeholder, then the result must parse as a URL. Optional: `auth`, `headers`, `oauth`, `enabled`.

URL policy: `https`, or `http` only on `localhost`, `127.0.0.1`, or `::1`. These clients run in the [Vue](https://vuejs.org/) UI process via [`@ai-sdk/mcp`](https://ai-sdk.dev/).

`auth` is `"none"`, `"headers"`, or `"oauth"`:

| Value | Mode |
| --- | --- |
| `"none"` | No credentials. Set this explicitly for public servers. Do not include an `oauth` block. |
| `"headers"` | Static headers. `headers` must be present and non-empty. |
| `"oauth"` | OAuth. Use the `oauth` object for pre-registration. |

When `auth` is omitted, Vixl infers the mode: a non-empty `headers` object means `"headers"`; an `oauth` object or neither field means `"oauth"`. Use explicit `"none"` for public servers. Stdio servers are always `"none"`.

Bearer token example:

```json
{
  "type": "http",
  "url": "https://example.com/mcp",
  "auth": "headers",
  "headers": { "Authorization": "Bearer ${input:Authorization}" }
}
```

`oauth` fields:

| Field | Type | Notes |
| --- | --- | --- |
| `clientId` | string | Optional static client id. Blank means dynamic registration. |
| `clientSecret` | string | Optional. Must be a `${input:...}` template, never plaintext. |
| `scopes` | string[] | Optional OAuth scopes. |
| `callbackPort` | number | Optional. Positive integer for the local callback server. |
| `authServerMetadataUrl` | string | Optional. Must be a valid URL. |
| `allowedAuthorizationServers` | string[] | Optional. Each value must be a valid URL. |

Tokens and client secrets stay in the keychain (`vixl:mcp:<serverId>:oauth:tokens` and related keys).

## Templates and inputs

Values in `args`, `env`, `headers`, and HTTP `url` may contain `${input:id}` and `${env:NAME}`. Missing input at start sets status `auth_required` and opens the secrets form. Missing env throws `Missing environment variable: NAME`.

Each input is:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Required. Referenced as `${input:id}`. |
| `type` | `"promptString"` | Only allowed type. |
| `description` | string | Optional. |
| `password` | boolean | Optional. |

Resolved input values are stored as `vixl:mcp:<serverId>:input:<inputId>`.

## Trust

Trust is not in `mcp.json`. It lives in `settings.json` as `agent.mcp.trust`, keyed by server id and a fingerprint of command plus args, or of the URL. Untrusted servers cannot start or be called. Choices: This session, This workspace, Always, Never. See [settings.json](/reference/settings-json).

## Runtime statuses

These are connection states, not chat statuses: `connected`, `starting`, `stopped`, `error`, `auth_required`, `refreshing`.

See also [Chat statuses](/reference/chat-statuses) and [Troubleshooting](/resources/troubleshooting).
