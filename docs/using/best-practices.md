---
title: Best practices
description: Illustrative example of planning once, reusing the chat, using a cheaper sub-agent, and switching hosts; about 70% less than one full-price chat.
---

# Best practices

The cheap path is: write the plan once, keep the parent on that model so the host can reuse a cached prefix, and push implementation onto a cheaper sub-agent. The table below is a worked example with stated assumptions, not a guarantee of your bill.

## About 70% less (illustrative)

Assumptions for ten implementation turns:

- The long chat sends 24,000 input tokens and 4,000 output tokens each turn.
- After you have a plan, the parent sends 8,000 input tokens each turn (the plan is the prompt, not the whole planning thread).
- Each worker turn also sends a 4,000-token prompt.
- Three quarters of the output tokens run on the cheaper role.
- Illustrative frontier rates: $3 per million input tokens, $15 per million output tokens.
- The cheaper role is one third of that: $1 and $5. A published gap of that size is Haiku 4.5 versus Sonnet 4.6 at those list prices; treat the numbers as an example, they move.

| Step | 10-turn cost | How |
| --- | --- | --- |
| Same work in the long chat, one full-price model | $1.32 | `10 * ((24,000 * $3 + 4,000 * $15) / 1M)` |
| The plan is the prompt (8,000 input tokens instead of 24,000) | $0.84 | `10 * ((8,000 * $3 + 4,000 * $15) / 1M)` |
| Three quarters of output on the cheaper role, plus a 4,000-token worker prompt each turn | $0.58 | Parent input still $0.24; worker input $0.04; output $0.15 frontier + $0.15 cheaper |
| Repeated 8,000-token parent input is a cache read at half price after the first turn | $0.47 | First parent ingest $0.024; nine cache reads $0.108; worker input and output unchanged |
| The host is 20% off that mixed-role total | $0.38 | `$0.47 * 0.80` |

$0.38 is about 71% less than $1.32. A longer planning thread saves more than this one, which is only three times the plan.

The half-price cache read is the conservative end. [OpenAI](https://developers.openai.com/api/docs/guides/prompt-caching) and [Google](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview) both publish cache-read discounts up to 90% on current models. The 20% sale is also conservative: [OpenRouter's discounted list](https://openrouter.ai/collections/discounted-models) shows promotions from about 38% off upward, and those offers start and end without notice.

What Vixl actually does toward a cache hit is in the next section. The discount itself is the provider's.

## Plan once and reuse the plan

You already paid for the planning tokens. Keep `PLAN.md` and run **Build** or **Orchestrate** against it instead of re-planning in a new thread. See [Work with plans](/using/work-with-plans).

## Keep the parent on the planning model

Prompt caching is a host feature. It needs a stable prefix on the same model. Vixl's part is to keep you in the same chat: **Build** (with **Build in a fresh chat** unchecked) and **Orchestrate** continue in the last build chat recorded on the plan, else the chat that created it.

Stay on the model you planned with. Switching the model in that thread typically means the host ingests the whole history again. Vixl requests Anthropic prompt caching on native Anthropic and AI Gateway Claude calls. Other hosts may cache on their own when the prefix matches. Vixl does not bill you and does not control the host's hit rate.

**Orchestrate** is the case where this matters most: the parent keeps the long context, and each worker is prompted with only the task it needs. Put the parent on the planning model. Put implementation on the Subagent role. See [Orchestrate sub-agents](/using/orchestrate-sub-agents).

## Push implementation to a cheaper sub-agent

Settings **Subagent** (`models.subagent`) is the default for nested runs. Orchestrator mode is the lock that keeps the parent from writing files itself, so the expensive model is not also doing the edits. Use that when the work splits. Agent mode can spawn workers too, but that parent can still implement in-thread.

## When to use a fresh chat

Check **Build in a fresh chat (new context)** when the planning transcript is noise, or when you want a clean Agent-mode run that should not see the research turns. The next chat is titled with the plan and the handoff is "read this `PLAN.md`." You pay to ingest the plan in a short thread instead of carrying the planning conversation forward.

**Orchestrate** has no fresh-chat checkbox. If the source chat is gone, Vixl creates a new one titled with the plan.

If you need a different parent model, expect a full ingest of whatever history that chat still has. Prefer a fresh chat over switching models in a long thread.

## Switch hosts when the same model is on sale

Add more than one [provider](/customize/providers). The same model is often sold by more than one host. When a host runs a sale, point the role or the chat picker at that provider. The saved ref is `providerId::modelId`, so the model id stays the same while the host changes. See [Models](/customize/models).
