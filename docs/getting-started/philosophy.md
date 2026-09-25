---
title: Philosophy
description: Vixl is a local-first, BYOK desktop LLM harness with a short list of opinions and a finite roadmap.
---

# Philosophy

A short list of opinions I had when creating this project.

## No humanizing the bot (unless you want to I guess?)

A LLM is not something to humanize, and the moment you begin to it's hard to tell what the real underlying state of the system is.

A number of harnesses decorate server processing with descriptions such as "planning next moves."

Usually we'd really call that prefill, or processing.

However in order to hide delays, or intermittent token generation so the user doesn't see how many tokens are really being used.

Companies ideal is:

User prompt -> something (hidden) -> result.

Second to that Vixl does not call the LLM "you" or humanize its tasks in any system prompt.

Vixl does not attatch as a co-author.

## Plans get persisted

"Planning" or the concept of todo files is something everyone is familiar with.

Some of us use ticket software like Linear, or Jira, where plans are just artifacts in the cloud.

Some people also, or often just need a better documented todo list thats persisted.

I always thought it was weird that we decided plans were markdown documentation that described the desired state of something, but everyone just decided to toss it after.

Plan mode writes a `PLAN.md` under `.vixl/plans/`.

You can also create one by hand in settings, or when viewing a projects page. 

It should just feel like writing a shopping list.

## Feature complete

Once the [roadmap](/resources/roadmap) is met, I don't really want to keep adding unless theres a very worthwhile RFC.

When you have people working 40hrs a week on a project, overtime it just becomes bloatware.

People just want software that works, and does a thing.

Once it does that thing, don't change the thing.

## Local first design

I bought a Framework desktop, and began playing with LLMs.

The Strix Halo is no Nvidia 5090 by any means.

So I needed a incredibly minimal harness, that wasn't a ton of config to setup.

This project was born out of that.

The alternatives were very "pick your poison" feeling.

[OpenCode](https://opencode.ai/) would not show reasoning for Qwen even though it appeared in traces.

[VS Code](https://code.visualstudio.com/) agents required an account even for local models, and plans lived in chats.

With a router you specify every model yourself.

[Cursor](https://cursor.com/) and [Antigravity](https://antigravity.google/) are cloud-only.

## Git neutrality

A LLM is a tool, not a person, and not a co-author.

## Fail loud

I don't know what it is about LLM code, since it's just trained on codebases, maybe people really do this.

However I've noticed an increase in voided calls, no-op catches, and comments saying "dont throw."

Whatever happened to fail loudly?

In production, sure we don't expose things to the user.

However this is a hackable OSS project, I assume a non-zero number of people will need to debug parts of this app.

So all catches, and errors must bubble up to something useable for humans.

This means _you will see error_ toasts, and sometimes they might be noise, and other time it's a legit blocker.

Open an issue, a PR, or some artifact.

## No cloud, ever

Self explanatory.

## Delete means delete

No archive, or "forget" I just wanted deleted chats to be deleted.