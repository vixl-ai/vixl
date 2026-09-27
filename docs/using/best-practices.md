---
title: Best practices
description: Save about 70% versus the same implementation in one full-price chat by planning once, caching, using a cheaper sub-agent, and switching hosts on a sale.
---

# Best practices

Save about 70% versus the same implementation in one full-price chat by planning once, caching, using a cheaper sub-agent, and switching hosts on a sale.

## About 70% less

Ten implementation turns. The long chat sends 24,000 input tokens and 4,000 output tokens each turn. The plan-scoped chat sends 8,000 input tokens. Illustrative frontier rates are $3 per million input tokens and $15 per million output tokens. The cheaper role is one third of that. A published gap of that size is Haiku 4.5 at $1 and $5 versus Sonnet 4.6 at $3 and $15.

| Step | 10-turn cost |
| --- | --- |
| Same work in the long chat, one full-price model | $1.32 |
| The plan is the prompt (8,000 input tokens instead of 24,000) | $0.84 |
| Three quarters of the output runs on the cheaper role, plus a 4,000-token worker prompt each turn | $0.58 |
| The repeated plan is a cache read at half price after the first turn | $0.47 |
| The host is 20% off on that same model | $0.38 |

$0.38 is about 70% less than $1.32. A longer planning thread saves more, because this one is only three times the plan.

The half-price cache read is the low end. [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) and [Google](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview) both publish cache-read discounts up to 90% on current models. The 20% sale is also the low end: [OpenRouter's discounted list](https://openrouter.ai/collections/discounted-models) shows promotions from about 38% off upward, and those offers start and end without notice.

## Lock the parent to guiding

Orchestration is first class. [Orchestrator mode](/concepts/chat-modes) locks the parent to guiding sub-agents. The parent never mutates files itself. Writes, edits, patches, deletes, shell, and git mutations are not on its allowlist. Implementers are nested agents, often on the cheaper `models.subagent` role, each given only the prompt they need.

Use that lock when the work splits. Keep the parent on the model that already has the plan and the chat. Put implementation on sub-agents. See [Orchestrate sub-agents](/using/orchestrate-sub-agents).

## Pay for a plan once

Plans are durable records. You already paid for those tokens. Do not treat `PLAN.md` as scratch. Build and Orchestrate exist so the next run is grounded in that file, not in a discarded turn. See [Work with plans](/using/work-with-plans).

## Use the plan header to keep cost down

The plan tab header is built to lower cost. The buttons are Orchestrate and Build. The fresh-chat choice lives in the Build plan dialog as a checkbox.

Building in the same chat after switching models cache-misses the entire previous conversation and the plan on the new model. The new model has to ingest all of it again.

Orchestrating with the same model you planned with, as the parent, retains the cache. Sub-agents (often cheaper models) are guided with only the info needed to complete their tasks. The parent keeps the long context. The workers do not.

Build stays in that chat (last build chat, else the source Plan chat) and maintains the cache. Same model and thread, still reading that `PLAN.md`.

Checking Build in a fresh chat (new context) in the Build plan dialog treats the plan as a hyper-tuned prompt. The next agent ingests only the plan, not the chat history. Use it when the planning thread is noise, or when you want a clean Agent-mode run that should not see the research turns.

Stay on the planning model if you want the cache. Click Build to continue in that chat. Click Orchestrate to keep the parent on that model and spawn sub-agents. Enable Build in a fresh chat (new context) when the plan file should be the whole prompt.

If you need a different parent model, expect a cache miss. Switching models in that chat, then clicking Build, pays that cost.

## Switch hosts when the same model is on sale

Add more than one [provider](/customize/providers). The same model is often sold by more than one host. When a host runs a sale, point the role or the chat picker at that provider. The saved ref is `providerId::modelId`, so the model id stays the same while the host changes. See [Models](/customize/models).

[Use the workbench](/using/use-the-workbench)
