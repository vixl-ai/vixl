---
title: How Vixl works
description: Vixl is a local-first desktop LLM UI built with Vue, Tauri, and Rust, with no home server and no analytics.
---

# How Vixl works

Vixl is a local-first desktop app for chatting with LLMs and running coding agents. You bring your own keys and hosts. There is no Vixl account, no Vixl home server, and the app does not ship analytics.

The UI is [Vue](https://vuejs.org/). The shell is [Tauri](https://tauri.app/). The backend is [Rust](https://www.rust-lang.org/). The agent harness runs on your machine. The Vue process talks to the local Tauri/Rust process, which owns the filesystem, PTY, git, MCP stdio, keychain, and SQLite.

![Vixl chat thread with an agent turn](/features/harness.png)

## Network

You configure most network calls: model providers, [MCP](https://modelcontextprotocol.io/) servers, and `web_fetch` when you allow it. The app also fetches the public models.dev catalog, downloads [language servers](/customize/language-servers) when auto-download is on (the default) and a portable Node runtime if needed, runs the [code graph](/concepts/code-graphs) CLI via `npx`, and checks [GitHub Releases](https://github.com/vixl-ai/vixl/releases) for updates. [Privacy](/resources/privacy) lists those calls.

## Where state lives

API keys and MCP secrets stay in the OS keychain, never in `.vixl` JSON. How that vault is named and where Linux falls back if Secret Service is missing is on [Providers](/customize/providers).

Chats, messages, usage, and workbench tabs live in SQLite under the personal `.vixl` directory. Each chat also has a directory of files. Deleting a chat drops both. Settings, MCP configs, plans, skills, agents, rules, and `AGENTS.md` live in `.vixl` trees: a personal tree in app data, and a project tree at `<repo>/.vixl` that you can commit. The registered folder list and the active project id are personal. Code graph indexes are personal, not in the repo.

The exhaustive path list is on [.vixl layout](/reference/vixl-layout). Merge rules are on [The .vixl directory](/concepts/the-vixl-directory).

## Modes, permissions, and context

[Chat modes](/concepts/chat-modes) decide which tools exist on a turn. [Permissions and approvals](/concepts/permissions-and-approvals) decide which of those tools may run without asking you.

Each turn builds a small system prompt: a short workspace identity, the mode skill, then catalogs of names. Full MCP schemas and skill bodies load when the agent asks. That is [progressive tool discovery](/concepts/context), and it is why local prefills stay smaller than harnesses that dump every tool schema up front. Built-in prompts describe the workspace and tools. They do not give the model a persona.

If you have not added a provider yet, [set up providers and models](/getting-started/set-up-providers-and-models). [Your first chat](/getting-started/your-first-chat) walks through sending a message.
