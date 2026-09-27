---
title: Models and roles
description: Vixl does not host models; you bring a BYOK provider and pick personal models per role such as Ask, Agent, and Subagent.
---

# Models and roles

Vixl does not host models. You bring a provider, then pick models per role. Providers and models are personal settings. Project `settings.json` cannot keep `providers.*`, `models.*`, or `lsp.*` keys. If those keys exist on disk they are stripped.

## Providers first

[Settings > Providers](/customize/providers) is empty until you add one. The catalog is the [AI SDK](https://ai-sdk.dev/) provider list plus OpenAI-compatible entries (including [Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/)). **Custom OpenAI-compatible** is a named endpoint you configure (default name `local`, default base URL `http://localhost:1234/v1`).

Most catalog providers store an API key in the OS keychain. Ollama and LM Studio skip the API key dialog (`requiresApiKey: false`). Ollama defaults to `http://localhost:11434/v1`. LM Studio defaults to `http://localhost:1234/v1`. Adding a provider does not pick a default model.

Until a provider exists, the model picker is disabled and offers **Add a provider**. Send requires a model.

## Roles

[Settings > Models](/customize/models) is blocked until a provider exists: **Configure at least one provider before choosing models.** Roles:

Default (`models.default`) is the fallback for every other role.

Ask, Plan, Agent, and Orchestrator (`models.ask`, `models.plan`, `models.agent`, `models.orchestrator`) are the [chat mode](/concepts/chat-modes) defaults. Agent is also the model for single-agent Build from a plan. Orchestrator is the parent for Orchestrator mode and for Orchestrate from a plan.

Subagent (`models.subagent`) sits nested under Orchestrator. It is the default for `spawn_subagent` when the spawn call and the agent file do not set a model. If Subagent is unset, resolution falls back to Agent, then Default.

Title (`models.title`) generates short titles for new chats. Auto-title (`chat.autoTitle`, default on) lives on that row. The Title picker is disabled when Auto-title is off. If Title is still using Default, Settings warns: prefer a small, low-cost model for this background task.

There is no compaction role. Compaction uses the chat's model if set, otherwise Default, to protect the cache. See [Compact and hand off long chats](/using/compact-and-hand-off-long-chats).

**Use default** clears a role override (every role except Default) and its reasoning override.

The chat input model picker can override the role for that thread. Changing mode does not swap a model you already picked.

## Reasoning and catalog options

Each role has a paired `models.<role>Reasoning` setting. Nested runs pick reasoning from the session lock, then the agent file, then catalog options, then the role default.

Per-model catalog options (allowed, fast, reasoning effort, context window, max output) save to `models.catalogOptions`.

[Set up providers and models](/getting-started/set-up-providers-and-models) is the first-run path. [Custom agents](/customize/custom-agents) can pin their own model in frontmatter, which wins over the Subagent role unless a plan lock or spawn call overrides it.
