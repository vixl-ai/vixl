---
title: Providers
description: Add BYOK providers in Vixl Settings. API keys go in the OS keychain, never in settings.json.
---

# Providers

A provider is the host you send chats to: OpenAI, Anthropic, a local [Ollama](https://ollama.com) daemon, or any OpenAI-compatible URL. Providers are personal. They live in Settings > Providers and write `providers.*` in the user [`.vixl` `settings.json`](/reference/settings-json). A project folder cannot override them, and API keys never go in that JSON.

The model picker stays disabled until at least one provider exists. Adding a provider does not pick a default model. After you add one, [set role models](/customize/models).

## Add a catalog provider

1. Open **Settings**, then **Providers**.
2. Choose **Add provider**.
3. Pick an entry from **AI SDK providers** or **OpenAI-compatible**, or skip the catalog and add a [custom endpoint](#custom-openai-compatible-endpoints).

The dialog searches by display name or id. Empty search shows the full catalog: first-party [AI SDK](https://ai-sdk.dev) packages plus a short OpenAI-compatible list Vixl ships (48 entries; table at the bottom).

Choosing a catalog id writes `providers.<id>.apiKeyRef` (the ref is that id). Unless the provider skips a key, **Add API key** opens next. Ollama and LM Studio skip that step.

## API keys

Paste the key and save. An empty value is refused. **Clear key** removes the secret. The row shows whether a key is configured, missing, or optional.

The secret is stored as `vixl:provider:<apiKeyRef>`. Every keychain key must start with `vixl:`. The vault account `vixl:vault` is reserved and cannot be used as a secret name.

On macOS and Windows, Vixl uses the OS keychain service `vixl` and keeps one JSON vault under that account. On Linux it uses Secret Service when that is available. If Secret Service is missing or access is denied, it falls back to `secrets-vault.json` in the app config directory (not inside `.vixl`), created with mode `0600`. Older per-key entries are merged into the vault the first time they are read.

MCP secrets use the same vault. Their key names are documented on [MCP servers](/customize/mcp-servers).

## Test a connection

Use **Test connection** on a provider row (or in the custom-endpoint dialog) to probe the host. HTTP 401 or 403 means the key is wrong. Other failures include the server message when the body has one. Most hosts are probed with `GET {baseURL}/models` (Bearer only when a key is present). Catalog OpenAI-compatible hosts use their default base URL when you have not set another.

## Local hosts

Ollama and LM Studio are in the OpenAI-compatible catalog and do not require an API key.

| Host | Id | Default base URL |
| --- | --- | --- |
| Ollama | `ollama` | `http://localhost:11434/v1` |
| LM Studio | `lmstudio` | `http://localhost:1234/v1` |

Test, live `/models` listing, and runtime all use those defaults. If Ollama's live list fails, the catalog fallback id is `llama3.2`.

## Custom OpenAI-compatible endpoints

**Custom OpenAI-compatible** is for any host that speaks an OpenAI-style `/v1` HTTP API, including a URL you run yourself. Defaults: name `local`, base URL `http://localhost:1234/v1`. The saved type is `openai-compatible` under `providers.custom.<id>`. The id is a slug of the name on create and stays the same if you rename later. Name must be at least one character. The base URL must be a valid URL. Invalid config is refused.

What the fields do:

- **Name** and **base URL** identify the endpoint.
- **API key** is optional. Leave it blank for local servers that do not authenticate.
- **Include usage** (on by default) asks the endpoint to return token usage with responses.
- **Structured outputs** (off by default) opts into structured-output support when the host implements it.
- Extra **headers** and **query params** are attached to requests.
- **Models** can be imported from `{baseURL}/models`, added by id, or left empty so Vixl lists live `/models` at pick time.

Import adds new ids and skips ones already in the list. If the endpoint returns none, the list is unchanged. Each model row needs an id. You can also set a display name, context and max tokens, tools / vision / thinking / stream flags, and USD-per-1M pricing. Missing pricing shows a warning. Advanced sampling, reasoning, per-model headers, and extra JSON options are optional.

Create and edit stay in the same dialog so you can import models, then save again. A custom row subtitle is the configured model count.

## Routers

Point a custom OpenAI-compatible endpoint at a router, then import from `/models`. That `GET`s `{baseURL}/models` and adds new ids so you pick models instead of typing them. [OpenRouter](https://openrouter.ai) is also in the OpenAI-compatible catalog (`openrouter`, `https://openrouter.ai/api/v1`).

## Remove a provider

Delete the row. Vixl removes the keychain secret and the `providers.*` settings keys for that id.

Provider refs and custom endpoint objects are stored in [settings.json](/reference/settings-json). Next, [assign models to roles](/customize/models).

<details>
<summary>Catalog (name and id)</summary>

48 entries, in catalog order.

| Name | Id |
| --- | --- |
| AI Gateway | `gateway` |
| Alibaba | `alibaba` |
| Amazon Bedrock | `amazon-bedrock` |
| Anthropic | `anthropic` |
| AssemblyAI | `assemblyai` |
| Azure OpenAI | `azure` |
| Baseten | `baseten` |
| Black Forest Labs | `black-forest-labs` |
| ByteDance | `bytedance` |
| Cartesia | `cartesia` |
| Cerebras | `cerebras` |
| Claude Platform on AWS | `claude-aws` |
| Cohere | `cohere` |
| Deepgram | `deepgram` |
| DeepInfra | `deepinfra` |
| DeepSeek | `deepseek` |
| ElevenLabs | `elevenlabs` |
| Fal | `fal` |
| Fireworks | `fireworks` |
| Gladia | `gladia` |
| Google | `google` |
| Google Vertex AI | `google-vertex` |
| Groq | `groq` |
| Hugging Face | `huggingface` |
| Hume | `hume` |
| Kling AI | `klingai` |
| LMNT | `lmnt` |
| Luma | `luma` |
| Mistral AI | `mistral` |
| Moonshot AI | `moonshotai` |
| Open Responses | `open-responses` |
| OpenAI | `openai` |
| Perplexity | `perplexity` |
| Prodia | `prodia` |
| QuiverAI | `quiverai` |
| Replicate | `replicate` |
| Rev.ai | `revai` |
| Together.ai | `togetherai` |
| Vercel | `vercel` |
| Voyage AI | `voyage` |
| xAI Grok | `xai` |
| Clarifai | `clarifai` |
| Heroku | `heroku` |
| LM Studio | `lmstudio` |
| NEAR AI Cloud | `near-ai` |
| NVIDIA NIM | `nvidia-nim` |
| Ollama | `ollama` |
| OpenRouter | `openrouter` |

</details>
