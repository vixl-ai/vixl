---
title: Set up providers and models
description: Add a BYOK provider in Settings, test the connection, then set a default model so you can send a chat.
---

# Set up providers and models

Vixl does not host models. Add a provider, store a key if it needs one, then pick a default model. You cannot send a chat until a model is selected.

## Add a provider

1. Open **Settings** in the left sidebar footer.
2. Open **Providers**.
3. Click **Add provider**.
4. Pick a catalog provider, or **Custom OpenAI-compatible**.
5. Save an API key if you are asked for one.
6. On the provider row, use **Test connection**.

[Ollama](https://ollama.com/) and [LM Studio](https://lmstudio.ai/) skip the API key step. Default URLs and the rest of the catalog are on [Providers](/customize/providers). Adding a provider does not pick a default model for you.

A 401 or 403 on test means the key is wrong.

## Set a default model

1. Open **Models** in Settings.
2. Set **Default**.

Every other role uses Default until you override it. You do not need those overrides for a first chat. Role defaults, Auto-title, and per-chat picks are on [Models](/customize/models) and [Models and roles](/concepts/models-and-roles).

Starting a chat from the sidebar is blocked until Default or Agent is set. Sending from the home input requires a model on the picker.

Next, [add a project](/getting-started/add-a-project), or skip that and [send a chat](/getting-started/your-first-chat).
