---
title: Comparison
description: Compare Vixl to VS Code Copilot, Cursor, and Antigravity on license, accounts, BYOK, local models, keys, MCP, and plans.
---

# Comparison

Vixl is a local-first BYOK desktop app: no Vixl account, keys stay on your machine, and you pay the model host you configured. The [origin story](/getting-started/philosophy) is on Philosophy.

Pricing and model catalogs change often. Use each vendor's own pages for current plans: [GitHub Copilot](https://docs.github.com/en/copilot/get-started/plans), [Cursor](https://cursor.com/pricing), [Google Antigravity](https://antigravity.google/pricing).

| | Vixl | [VS Code](https://code.visualstudio.com/) + GitHub Copilot | [Cursor](https://cursor.com/) | [Google Antigravity](https://antigravity.google/) |
| --- | --- | --- | --- | --- |
| License | [MIT](https://github.com/vixl-ai/vixl/blob/main/LICENSE) | vscode source is MIT. The shipped VS Code binary uses a [Microsoft product license](https://code.visualstudio.com/license). Copilot is commercial. | Proprietary | Proprietary |
| Account required | No | GitHub account for Copilot | Cursor account | Google account |
| BYOK | Yes. Keys stay in the OS keychain and are sent only to the host you configured. | Yes for Chat. See [VS Code BYOK](https://code.visualstudio.com/blogs/2026/06/18/byok-vscode). | Yes for listed chat providers. The key is sent to Cursor's backend with every request for prompt building. Tab completion always uses Cursor models. Zero Data Retention does not apply to BYOK. See [Cursor API keys](https://cursor.com/docs/settings/api-keys). | No. Official docs: no bring-your-own-key or bring-your-own-endpoint. See [Antigravity plans](https://www.antigravity.google/docs/plans/). |
| Local models | Yes. [Ollama](https://ollama.com/) and other local OpenAI-compatible hosts, with no account. | Documented for Chat. See [VS Code language models](https://code.visualstudio.com/docs/copilot/language-models). | AI requests are routed through Cursor's servers, including BYOK. | Not documented as a first-party local provider. |
| Where keys are sent | Directly to the provider URL you configured. There is no Vixl backend. | Copilot traffic goes to GitHub. BYOK is described in Microsoft's docs. | Cursor's backend, then the provider. The key is not stored on Cursor's servers after the request. | Google. There is no BYOK path. |
| MCP transports | stdio, http, and sse. | stdio and HTTP. See [VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers). | stdio, SSE, and Streamable HTTP. See [Cursor MCP](https://cursor.com/docs/mcp). | stdio, Streamable HTTP, and SSE. See [Antigravity MCP](https://antigravity.google/docs/mcp/). |
| Plans persisted | Yes. Plan files live under `.vixl/plans/`. See [Work with plans](/using/work-with-plans). | See vendor docs. | See vendor docs. | See vendor docs. |

See [FAQ](/resources/faq).
