---
title: Best practices
description: Keep Vixl cost down by locking the parent to guiding sub-agents, paying for a plan once, reusing the same model for cache, and switching providers when the same model is on sale.
---

# Best practices

Keep Vixl cost down by locking the parent to guiding sub-agents, paying for a plan once, reusing the same model for cache, and switching providers when the same model is on sale.

## Lock the parent to guiding

Orchestration is first class. [Orchestrator mode](/concepts/chat-modes) locks the parent to guiding sub-agents. The parent never mutates files itself. Writes, edits, patches, deletes, shell, and git mutations are not on its allowlist. Implementers are nested agents, often on the cheaper `models.subagent` role, each given only the prompt they need.

Use that lock when the work splits. Keep the parent on the model that already has the plan and the chat. Put implementation on sub-agents. See [Orchestrate sub-agents](/using/orchestrate-sub-agents).

## Pay for a plan once

Plans are durable records. You already paid for those tokens. Do not treat `PLAN.md` as scratch. Build and Orchestrate exist so the next run is grounded in that file, not in a discarded turn. See [Work with plans](/using/work-with-plans).

## Use the plan header to keep cost down

The plan tab header is built to lower cost. The buttons are Orchestrate and Build. The fresh-chat choice lives in the Build plan dialog as a checkbox.

Building in the same chat after switching models cache-misses the entire previous conversation and the plan on the new model. The new model has to ingest all of it again.

Orchestrating with the same model you planned with, as the parent, retains the cache. Sub-agents (often cheaper models) are guided with only the info needed to complete their tasks. The parent keeps the long context. The workers do not.

On Claude, a cache read is 10% of the base input price: 90% off those tokens. A few models discount further. Vixl sends an ephemeral cache breakpoint on Anthropic, and on AI Gateway when the model is Claude. The multipliers are on [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).

Build stays in that chat (last build chat, else the source Plan chat) and maintains the cache. Same model and thread, still reading that `PLAN.md`.

Checking Build in a fresh chat (new context) in the Build plan dialog treats the plan as a hyper-tuned prompt. The next agent ingests only the plan, not the chat history. Use it when the planning thread is noise, or when you want a clean Agent-mode run that should not see the research turns.

Stay on the planning model if you want the cache. Click Build to continue in that chat. Click Orchestrate to keep the parent on that model and spawn sub-agents. Enable Build in a fresh chat (new context) when the plan file should be the whole prompt.

If you need a different parent model, expect a cache miss. Switching models in that chat, then clicking Build, pays that cost.

## Switch hosts when the same model is on sale

Add more than one [provider](/customize/providers). The same model is often sold by more than one host. When a host runs a sale, point the role or the chat picker at that provider. The saved ref is `providerId::modelId`, so the model id stays the same while the host changes. See [Models](/customize/models).

[Use the workbench](/using/use-the-workbench)
