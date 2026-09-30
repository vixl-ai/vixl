---
title: Troubleshooting
description: Fix common Vixl failures from the model picker, unsigned installers, keychain, MCP trust, CodeGraph, and update checks.
---

# Troubleshooting

Most failures show a toast. Two silent cases: canceling the folder picker, and the launch update check. Re-run that check from Settings > General when you want a visible result. Update checks do not run in dev or outside the desktop app.

## macOS Gatekeeper or Windows SmartScreen blocks the app

macOS and Windows installers are unsigned. Gatekeeper or SmartScreen may prompt on first open. See [Installation](/getting-started/installation) for how to open anyway.

## The model picker is disabled

The chat model picker and the Settings > Models pickers stay disabled until at least one provider exists. Opening the disabled chat picker still shows **No providers configured**. Starting a chat from the sidebar without a default model shows **Select a default model in Settings before starting a chat**. Sending without a provider shows **No provider configured**.

1. Open Settings > Providers and add a catalog or custom endpoint.
2. Save an API key if the host requires one. [Ollama](https://ollama.com) and [LM Studio](https://lmstudio.ai) do not.
3. Open Settings > Models and pick a default model.
4. Return to the chat and choose a model.

See [Set up providers and models](/getting-started/set-up-providers-and-models).

## Test connection fails with 401

**Test connection** GETs the host's models list (`GET {base}/v1/models` for OpenAI-compatible hosts). AI Gateway is the exception: it probes `https://ai-gateway.vercel.sh/v1/credits`. HTTP 401 or 403 becomes **Authentication failed. Check your API key.** The toast title is **Connection failed**. A missing secret is **No API key in keychain** or **No API key configured**. Other HTTP failures include the server message when present.

1. Open Settings > Providers.
2. Confirm the base URL for a local host. Ollama defaults to `http://localhost:11434/v1`. LM Studio defaults to `http://localhost:1234/v1`.
3. Save the key again if the catalog requires one.
4. Run **Test connection**.

See [Providers](/customize/providers).

## Keychain access denied

API keys and MCP secrets live in the OS keychain. Service names, key format, and the Linux fallback file are on [Providers](/customize/providers).

On macOS and Windows, a keychain error surfaces a toast. The OS text interpolates the inner error:

- `OS keychain access denied ({inner}). Unlock your system keyring or grant vixl access.`
- `OS keychain unavailable ({inner}). On Linux, ensure a Secret Service provider (for example gnome-keyring) is running.`

1. Unlock the system keyring.
2. Grant Vixl access if the OS prompts.
3. Save the API key again from Settings > Providers.

## MCP server will not start / not trusted

Untrusted servers cannot start or be called. Start or enable may open **Trust MCP server?** with **This session**, **This workspace**, **Always**, or **Never**. Changing command, args, or URL requires trust again. Personal **Never** wins over a project grant.

If the agent calls an untrusted server, the tool error is:

`MCP server "<id>" has not been granted trust. Open Settings → MCP and start the server to grant trust before the agent can call its tools.`

Starting without trust throws `MCP server "<id>" is not trusted for the current configuration`. Start failures toast **Failed to start server**.

Stdio command must be an allowlisted PATH basename: `MCP command must be a PATH basename (for example npx or uvx), not a filesystem path`. HTTP URLs must be `https`, or `http` on localhost: `MCP URL must use https, or http on localhost / 127.0.0.1`. Missing `${input:id}` values surface as `auth_required:inputs` and the secrets form.

1. Open Settings > MCP or the project MCP tab.
2. Start the server and pick a trust scope.
3. Fill secrets if the server declares inputs.

See [MCP servers](/customize/mcp-servers).

## Code graph not ready

The Graph chip shows **Offline**, **Indexing**, **Syncing**, **Ready**, or **Error**. Search needs a connected graph. On project activate, Vixl runs `codegraph init` if `codegraph.db` is missing, then starts an in-memory MCP server via `npx`. Rebuild from the Graph tab needs an open project. Failure toasts: **Open a project to rebuild the graph**, **Failed to rebuild graph**.

Indexes live under personal `.vixl/graphs/`, never in the repo.

1. Open the project.
2. Open the Graph tab.
3. Click **Rebuild index** if the status is not **Ready**. First index may wait on `npx` fetching [`@colbymchenry/codegraph`](https://www.npmjs.com/package/@colbymchenry/codegraph).

See [Code graphs](/concepts/code-graphs).

## Update check fails

A silent check runs on app mount. Manual check is Settings > General (**Check for updates**). Failures toast **Failed to check for updates**. Success with nothing new: **No updates available**. Install failures: **Failed to install update**. Checks are skipped in dev and outside Tauri. The endpoint is `https://github.com/vixl-ai/vixl/releases/latest/download/latest.json`.

1. Open Settings > General.
2. Run **Check for updates**.
3. If the toast describes a network or signature error, confirm you can reach [GitHub Releases](https://github.com/vixl-ai/vixl/releases).

See [Installation](/getting-started/installation).
