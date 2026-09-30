---
title: Models and roles
description: Vixl does not host models; you bring a BYOK provider and pick personal models per role such as Ask, Agent, and Subagent.
---

# Models and roles

Vixl does not host models. You bring a provider, then pick models per role. Providers and models are personal settings. Project `settings.json` cannot keep `providers.*`, `models.*`, or `lsp.*` keys. If those keys exist on disk they are stripped.

How to add providers and pick models is on [Providers](/customize/providers) and [Models](/customize/models). This page is the resolution rules those pickers feed.

## Providers first

Until a provider exists, the model picker is disabled and send is blocked. How to add a catalog provider, a custom OpenAI-compatible endpoint, or a local host is on [Providers](/customize/providers). Adding a provider does not pick a default model.

## Roles

Default (`models.default`) is the fallback for every other role.

Ask, Plan, Agent, and Orchestrator (`models.ask`, `models.plan`, `models.agent`, `models.orchestrator`) are the [chat mode](/concepts/chat-modes) defaults. Agent is also the model for single-agent Build from a plan. Orchestrator is the parent for Orchestrator mode and for Orchestrate from a plan.

Subagent (`models.subagent`) is the default for `spawn_subagent` when the spawn call and the agent file do not set a model, and when a plan has not locked a nested model. If Subagent is unset, resolution falls back to Agent, then Default.

Title (`models.title`) generates short titles for new chats. Auto-title (`chat.autoTitle`, default on) lives on that row. The Title picker is disabled when Auto-title is off. If Title is still using Default, Settings warns: prefer a small, low-cost model for this background task.

There is no compaction role. Compaction uses the chat's model if set, otherwise Default, so the rewrite stays on the same model as the thread. See [Compact and hand off long chats](/using/compact-and-hand-off-long-chats).

**Use default** clears a role override (every role except Default) and its reasoning override.

The chat input model picker can override the role for that thread. Changing mode does not swap a model you already picked.

## Reasoning and spawn order

Each role has a paired `models.<role>Reasoning` setting. Nested runs pick reasoning from the session lock, then the agent file, then catalog options, then the role default.

Spawn model order when there is no plan lock: the spawn `model` argument, then the agent file's `model`, then the Subagent role. A plan Orchestrate lock ignores the spawn argument and the agent-file model. [Custom agents](/customize/custom-agents) can pin a model in frontmatter.

Per-model catalog options (allowed, fast, reasoning effort, context window, max output) save to `models.catalogOptions`.
