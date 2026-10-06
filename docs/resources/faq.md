---
title: FAQ
description: Answers to common Vixl questions about the local-first BYOK desktop app, keys in the OS keychain, and the MIT license.
---

# FAQ

## What does Vixl stand for?

Vixl stands for "Vue Pixel", a love of building websites (pixels on a screen) with [Vue](https://vuejs.org/).

## Is Vixl going to keep adding features forever?

No. Once the [roadmap](/resources/roadmap) is met, Vixl gets only optimizations and bug fixes. Paid harnesses bloat because employees working 40-hour weeks need something to do. See [Philosophy](/getting-started/philosophy).

## Is there a cloud service?

No, never. There is no Vixl account and no Vixl home server. You bring your own keys and hosts. See [Privacy](/resources/privacy).

## Where are my keys?

In the OS keychain, never in `.vixl` or `settings.json`. On Linux without Secret Service, they fall back to `secrets-vault.json` in the app config dir. See [Providers](/customize/providers) for the key format.

## Do I need an account to use a local model?

No. [Ollama](https://ollama.com/) and other local OpenAI-compatible hosts work without a Vixl account and without an API key. Add a provider when you want one. See [Set up providers and models](/getting-started/set-up-providers-and-models).

## Where is my data?

Personal config is `~/.vixl` on every platform (on Windows, `%USERPROFILE%\.vixl`). Project config is `<repo>/.vixl`. Chats live in `vixl.sqlite` and under `.vixl/chats/`. See [.vixl layout](/reference/vixl-layout).

## What happens when I delete a chat?

The SQLite row and the chat directory are removed. There is no archive and no Vixl-side memory of that thread. If you used a cloud provider, that provider's retention is the provider's business. See [Privacy](/resources/privacy).

## Does Vixl send analytics?

No. The only telemetry-related string in the app is `CODEGRAPH_TELEMETRY=0`, which turns off the CodeGraph package's own telemetry. Vixl still makes the network calls listed on [Privacy](/resources/privacy).

## What license is Vixl?

[MIT](https://github.com/vixl-ai/vixl/blob/main/LICENSE). The desktop app is free. You pay the model host you configured. There is no Vixl subscription.

## How do I install it?

Download a build from [GitHub Releases](https://github.com/vixl-ai/vixl/releases) (macOS arm64, Linux x64, Windows), or build from source. macOS and Windows installers are unsigned, so Gatekeeper or SmartScreen may prompt on first open. See [Installation](/getting-started/installation).
