---
title: Models
description: Pick personal default and role models in Vixl Settings after you add a provider.
---

# Models

Model picks are personal. Settings > Models writes `models.*` in the user [`.vixl` `settings.json`](/reference/settings-json). A project folder cannot override them. Runtime still reads the provider key from the [OS keychain](/customize/providers).

Until a provider exists, this section is blocked. The chat input picker is disabled in the same case and offers **Add a provider**. Send requires a model.

Saved values are `providerId::modelId`. Pick a model to persist it.

## Set the default

**Default** (`models.default`) is the fallback every other role uses when that role has no override. Set this first. Without a resolved Default (or Agent, which falls back to Default), starting a chat from a plan is blocked until you pick one here.

## Role models

Each role has its own picker. Roles other than Default can fall back to Default. **Use default** clears that role and its reasoning override.

Ask, Plan, Agent, and Orchestrator are the [chat mode](/concepts/chat-modes) defaults. Agent is also used for single-agent plan builds. Orchestrator is the parent for Orchestrator mode and for Orchestrate from a plan, with nested **Parent** and **Subagent** pickers.

Subagent (`models.subagent`) is the default for nested `spawn_subagent` runs when an [agent file](/customize/custom-agents) does not set its own model. If Subagent is unset, resolution uses Agent, then Default.

Title (`models.title`) generates short titles for new chats. **Auto-title** (`chat.autoTitle`, on by default) lives on that row. Turning it off disables the Title picker. If Title is still using Default, Settings warns you to prefer a small, low-cost model for that background task.

Resolution (when the chat has no picker override): the role's own setting if set; for Subagent, then Agent, then Default; for chat modes and Title, Default. A per-chat picker override wins when present.

How modes consume these defaults is on [Models and roles](/concepts/models-and-roles).

Catalog providers list live `/models` from that endpoint (Ollama and LM Studio use their [default base URLs](/customize/providers)). You do not maintain a static list for those. Custom endpoint model rows (import, id, capabilities, pricing) are edited on the [provider](/customize/providers), not here.

## Per-model options

The extras panel on a model picker writes `models.catalogOptions` for that `providerId::modelId`:

- **Allowed in chat** hides the model from chat pickers when off.
- **Fast** when the model has a fast sibling.
- **Reasoning** when the model supports it: Default, None, Minimal, Low, Medium, High, Extra high, Max.
- **Context window** and **Max output** when the catalog reports those limits.

Role reasoning overrides are separate (`models.<role>Reasoning`) and are covered with the rest of role behavior on [Models and roles](/concepts/models-and-roles).

First-run setup is [Set up providers and models](/getting-started/set-up-providers-and-models). To attach tools from outside the model, [add MCP servers](/customize/mcp-servers).
