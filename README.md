<p align="center">
  <img src="./docs/media/readme/logo.png" alt="vixl" width="160" />
</p>

<h1 align="center">vixl</h1>

<p align="center">
  <a href="https://github.com/vixl-ai/vixl/actions/workflows/ci.yml"><img src="https://github.com/vixl-ai/vixl/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/vixl-ai/vixl/actions/workflows/deploy-docs.yml"><img src="https://github.com/vixl-ai/vixl/actions/workflows/deploy-docs.yml/badge.svg" alt="Deploy docs" /></a>
  <a href="https://vixl.app/"><img src="https://img.shields.io/badge/docs-GitHub%20Pages-blue" alt="Docs" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://vixl.app/"><img src="https://img.shields.io/badge/status-beta-blue.svg" alt="Status: Beta" /></a>
  <a href="https://github.com/vixl-ai/vixl/stargazers"><img src="https://img.shields.io/github/stars/vixl-ai/vixl?style=flat" alt="GitHub stars" /></a>
</p>

<p align="center">
  <a href="https://vuejs.org/"><img src="https://img.shields.io/badge/Vue.js-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue.js" /></a>
  <a href="https://v2.tauri.app/"><img src="https://img.shields.io/badge/Tauri-24C8DB?logo=tauri&logoColor=%23FFFFFF" alt="Tauri" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-000000?logo=rust&logoColor=white" alt="Rust" /></a>
  <a href="https://ai-sdk.dev/"><img src="https://img.shields.io/badge/Vercel%20AI%20SDK-000000?logo=vercel&logoColor=white" alt="Vercel AI SDK" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-000000?logo=claude&logoColor=white" alt="MCP" /></a>
  <a href="https://vixl.app/"><img src="https://img.shields.io/badge/local--first-BYOK-0ea5e9" alt="Local-first BYOK" /></a>
  <a href="https://vixl.app/"><img src="https://img.shields.io/badge/Agents%20UI-desktop-8b5cf6" alt="Agents UI" /></a>
</p>

---

## Sponsored by

<table align="center">
  <tr>
    <td align="center" valign="middle">
      <a href="https://getminds.ai/" target="_blank" rel="noreferrer">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="./docs/media/readme/minds-dark.png" />
          <img src="https://getminds.ai/images/logo.png" alt="Minds" height="56" />
        </picture>
      </a>
      <br />
      <a href="https://getminds.ai/">Minds</a>
    </td>
    <td align="center" valign="middle">
      <a href="https://www.getniche.ai/" target="_blank" rel="noreferrer">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="https://www.getniche.ai/niche-logo-dark.png" />
          <img src="https://www.getniche.ai/niche-logo-light.webp" alt="Niche" height="56" />
        </picture>
      </a>
      <br />
      <a href="https://www.getniche.ai/">Niche</a>
    </td>
  </tr>
</table>

---

Vixl is an open alternative to Antigravity, Cursor, and VS Code agents.

Save on token costs by utilizing routers, sales, and model mixing.

Local first design, built originally for using Qwen on a Halo Strix.

[View the estimated token counts](./spec/src/services/context/system-prompt-token-snapshot.test.ts)

## Getting started

<details id="install">
<summary><strong>Install</strong></summary>

Install a prebuilt app:

1. Download the installer for your platform (macOS arm64, Linux x64, Windows) from [GitHub Releases](https://github.com/vixl-ai/vixl/releases).
2. Verify the download with `SHA256SUMS.txt` from the same release tag: run `shasum -a 256 -c SHA256SUMS.txt` on macOS or `sha256sum -c SHA256SUMS.txt` on Linux.
3. Open the installed app.

Or build from source:

1. Install Node.js matching [`.nvmrc`](./.nvmrc) and a Rust toolchain from [rustup.rs](https://rustup.rs/).
2. Clone the repo and install dependencies: `git clone https://github.com/vixl-ai/vixl.git && cd vixl && npm ci`.
3. Start the desktop shell with `npm run tauri -- dev`.

</details>

<details id="add-a-provider-key">
<summary><strong>Add a provider key</strong></summary>

1. Open **Settings** from the sidebar footer.
2. Go to **Providers**.
3. Click **Add provider** and pick a catalog provider or a custom OpenAI-compatible endpoint.
4. Paste your API key into the key field and save. Ollama needs no key and defaults to `http://localhost:11434/v1`.
5. Click **Test connection** to confirm the key works.

Keys are stored in the OS keychain. They are never written to `.vixl` or `settings.json`.

</details>

<details id="select-a-default-model">
<summary><strong>Select a default model</strong></summary>

1. Open **Settings > Models**.
2. Set **Default** to the model every role falls back to.
3. Override individual roles if you want different models for **Ask**, **Plan**, **Agent**, **Orchestrator** (Parent, plus nested **Subagent**), or **Title**.
4. Toggle **Auto-title** on the Title role to generate short chat titles.

Without a Default model, starting a chat from the sidebar or file tree shows: `Select a default model in Settings before starting a chat`.

</details>

<details id="add-a-project">
<summary><strong>Add a project</strong></summary>

1. Click **Add project** in the Chats toolbar of the sidebar.
2. Choose the folder to register as a project.

You can also pick a project from the project picker on the home screen. **No project** starts a home chat that is not tied to a repo.

</details>

<details id="start-a-chat">
<summary><strong>Start a chat</strong></summary>

1. Click **New Agent** in the sidebar to open home.
2. Pick a project in the project picker, or keep **No project**.
3. Pick a mode: **Agent**, **Ask**, **Orchestrator**, or **Plan**.
4. Pick a model with **Select model** and set the permission dial (**Ask**, **Allowlist**, **Bypass**).
5. Type your prompt and send it. Use `@` to mention workspace files and `/` to run skills and agents.

</details>

<details id="how-vixl-compares">
<summary><strong>How vixl compares</strong></summary>

Sources: [GitHub Copilot plans](https://docs.github.com/en/copilot/get-started/plans), [VS Code language models](https://code.visualstudio.com/docs/copilot/language-models), [VS Code BYOK](https://code.visualstudio.com/blogs/2026/06/18/byok-vscode), [VS Code license](https://code.visualstudio.com/license), [VS Code MCP](https://code.visualstudio.com/docs/agent-customization/mcp-servers), [Cursor pricing](https://cursor.com/pricing), [Cursor models](https://cursor.com/docs/models-and-pricing), [Cursor API keys](https://cursor.com/docs/settings/api-keys), [Cursor MCP](https://cursor.com/docs/mcp), [Cursor terms](https://cursor.com/terms-of-service), [Antigravity pricing](https://antigravity.google/pricing), [Antigravity models](https://antigravity.google/docs/models/), [Antigravity plans](https://www.antigravity.google/docs/plans/), [Antigravity MCP](https://antigravity.google/docs/mcp/).

| | vixl | VS Code + GitHub Copilot | Cursor | Google Antigravity |
| --- | --- | --- | --- | --- |
| Editor cost | Free (MIT app) | Editor is free to download. The vscode source is MIT. The shipped VS Code binary uses a Microsoft product license. | Hobby is free. Pro $20/month, Pro+ $60/month, Ultra $200/month. Teams $40 and $120 per user/month. | Individual free tier with weekly rate limits. Higher quotas via Google AI Pro $19.99/month and Google AI Ultra. |
| AI cost | You pay the host you configured (BYOK). No vixl subscription. | Copilot Free $0 (limited credits, 2,000 completions/month), Pro $10/month, Pro+ $39/month, Max $100/month, Business $19/seat, Enterprise $39/seat. Extra usage billed as AI credits at $0.01 each. Copilot is a commercial subscription. | On-demand overage at API rates. Teams/Enterprise add a Cursor Token Rate of $0.25 per million tokens on third-party models, including BYOK. | Rate limits on the free tier. Paid Google AI plans raise quotas. Official docs: no BYOK or bring-your-own-endpoint for extra rate limits. |
| License | MIT | vscode source MIT; shipped binary Microsoft product license; Copilot commercial. | Proprietary. | Proprietary. |
| Model choice / BYOK | BYOK for the first-party provider catalog, custom OpenAI-compatible endpoints, and Ollama. Keys stay in the OS keychain. | Paid Copilot plans: picker over GitHub-hosted models (OpenAI, Anthropic, Google, xAI, others). Free plan is auto-model only. BYOK in VS Code Chat (Azure, Anthropic, Gemini, OpenAI, OpenRouter, Hugging Face, custom endpoints) does not apply to code completions. BYOK keys use VS Code SecretStorage (OS keychain backed). | Cursor-hosted Grok and Composer models plus third-party Anthropic, Google, OpenAI, and others listed in Cursor's model docs. BYOK: OpenAI, Anthropic, Google, Azure OpenAI, AWS Bedrock. Chat only. Tab completion always uses Cursor models. Keys are sent to Cursor's backend with every request for prompt building. Zero Data Retention does not apply to BYOK. | Gemini 3.8/3.7/3.6 Flash, Gemini 3.1 Pro, plus Claude Sonnet/Opus 4.6 (thinking) and GPT-OSS-120b on consumer plans. No first-party BYOK for extra limits (see AI cost). |
| Local and offline | Offline with local models (Ollama and other local OpenAI-compatible hosts). No account required. | Local models (Ollama, Foundry Local, custom endpoints) work for chat, but take extra configuration and still require a GitHub account. Completions still need Copilot. | Not a first-party local provider (no official Ollama support). AI features require Cursor's backend. | No first-party local inference for the reasoning model. No documented offline mode. |
| MCP | stdio, http, and sse. | Yes: stdio and HTTP, workspace or user `mcp.json`. | Yes: stdio, SSE, Streamable HTTP. | Yes: stdio, Streamable HTTP, SSE. |

</details>

<details id="what-vixl-does-not-include">
<summary><strong>What vixl does not include</strong></summary>

vixl ships no bundled product integrations. It does not pick a browser, a ticket tracker, or a cloud for you.

For example: there is no built-in browser automation or CDP. If you want a browser in the agent loop, add an MCP server you already use (Chrome MCP, Safari MCP, Playwright MCP, or another). People run different browsers, so vixl does not pick one.

If an MCP server exists for a tool, add it to `mcp.json` and vixl can use it.

</details>

<details id="left-sidebar">
<summary><strong>Left sidebar</strong></summary>

The sidebar lists your chats grouped by project, each with a status label like **Running**, **Needs approval**, or **Done**. From here you can start a new chat, search across projects and chats, pin chats, filter by status, add a project, and open **Settings**.

Right-click a chat to rename, fork, pin, or delete it.

</details>

<details id="home">
<summary><strong>Home</strong></summary>

Home is the screen vixl opens on. Type a prompt in the text box at the bottom and send it to start a chat.

Before you send, the bar under the input lets you set up the chat:

- **Project**: **No project** (not tied to a repo) or one of your added projects.
- **Mode**: **Agent**, **Ask**, **Orchestrator**, or **Plan**. See [Chat view](#chat-view).
- **Model**: overrides your default model for this chat only.
- **Permissions**: how often the agent asks before it acts.
- **Attachments**: add images to the prompt.
- **MCP** and **Skills**: choose which servers and skills the chat can use.

</details>

<details id="chat-view">
<summary><strong>Chat view</strong></summary>

There are four modes. **Ask** answers questions without changing files. **Plan** researches and writes a plan document. **Agent** makes the changes. **Orchestrator** splits work across sub-agents.

The permission dial controls how much the agent can do on its own: **Ask** (approve each action), **Allowlist** (actions you have allowed before run freely, anything new asks), or **Bypass** (file changes run without asking; shell, web, and MCP still ask).

When the agent needs approval, you can allow an action once, for the session, for the workspace, or always, or deny it.

Long conversations can be compacted to save context. You can queue messages while the agent works, watch and stop sub-agents, and export a transcript.

</details>

<details id="workbench">
<summary><strong>Workbench</strong></summary>

The right sidebar is the workbench. It has an editor (the same Monaco core as VS Code, with a file tree and language server support), terminals that open in your project, and a git view for status and diffs. Plans and running agent shells open here as tabs too.

</details>

<details id="project-view">
<summary><strong>Project view</strong></summary>

Each project gets a page with tabs for its chats, MCP servers, code graph, plans, skills, agents, and rules. These mirror the personal versions in Settings but apply only to that project.

The **Graph** tab shows the code index for the project. Search a symbol or file to see its callers, callees, and impact, or rebuild the index.

</details>

<details id="settings">
<summary><strong>Settings</strong></summary>

Settings holds everything that applies to you rather than one project: theme and updates, providers and models, language servers, permissions, and your personal MCP servers, plans, skills, agents, and rules.

Permissions is where you review what agents have been allowed to do: sandboxed terminal and network rules, stored allow and deny records, and a **Clear all** reset.

</details>

<details id="the-vixl-directory">
<summary><strong>The .vixl directory</strong></summary>

vixl keeps two config trees. API keys are in the OS keychain, not in either one.

Personal config lives in your app data folder under `.vixl`:

| Path | What it holds |
| --- | --- |
| `settings.json` | App settings: theme, models, permissions |
| `mcp.json` | Personal MCP servers |
| `vixl.sqlite` | Chat history and usage |
| `graphs/` | Code graph indexes |
| `agents/`, `skills/`, `plans/`, `rules/`, `AGENTS.md` | Your personal agents, skills, plans, rules, and instructions |

Project config lives at `<repo>/.vixl` and can be committed to share with a team:

| Path | What it holds |
| --- | --- |
| `settings.json` | Project overrides (never providers or models) |
| `mcp.json` | Project MCP servers (override personal ones by name) |
| `agents/`, `skills/`, `plans/`, `rules/`, `AGENTS.md` | The same files, scoped to the project |

</details>

<details id="codegraphs">
<summary><strong>Codegraphs</strong></summary>

vixl indexes each project into a code graph so agents can search symbols and see how the code connects instead of reading files one by one. Indexes are stored per user, never in the repo.

The project's **Graph** tab shows index status and stats, and lets you search a symbol or file to explore its callers, callees, and impact. Use **Rebuild index** to refresh it.

</details>

<details id="mcp">
<summary><strong>MCP</strong></summary>

Add MCP servers in Settings (personal) or on the project page (project). Config lives in `mcp.json`, and project servers override personal ones with the same name.

Servers can run over stdio, http, or sse. Stdio servers launch through common runners like `npx`, `uvx`, or `docker`. Secrets such as tokens are stored in the keychain, and vixl asks before trusting a new server. HTTP servers can sign in with OAuth.

Once connected, agents can call the server's tools in any chat.

</details>

<details id="agents-and-chat-modes">
<summary><strong>Agents and chat modes</strong></summary>

The four chat modes (**Agent**, **Ask**, **Orchestrator**, **Plan**) are built in. See [Chat view](#chat-view).

Custom agents are your own: markdown files in `.vixl/agents/` with a name, description, and optional model and tools. Create one with **New agent**, then run it with `/` in a chat. Custom agents run as sub-agents, so a chat can hand work to them.

</details>

<details id="plans">
<summary><strong>Plans</strong></summary>

Plan mode writes a plan document with a todo list, saved under `.vixl/plans/`. You can also create one by hand with **New plan**.

When the plan looks right, **Build now** has an agent implement the todos, or **Orchestrate** fans them out to background sub-agents that work in parallel.

</details>

<details id="skills-rules-and-agentsmd">
<summary><strong>Skills, Rules, and AGENTS.md</strong></summary>

Skills are reusable instruction packs in `.vixl/skills/`, run with `/` or loaded by agents when relevant. Rules in `.vixl/rules/` and a top-level `AGENTS.md` are always-on instructions added to every chat.

Each exists at personal and project level. When both define the same thing, the project version wins.

</details>

## Roadmap

1. Image edit and create support
2. Theme, glass, and deeper personalization

## Contributing

- Read [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, PR process, and signed commits.
- Follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
- Report vulnerabilities via [SECURITY.md](./SECURITY.md).
- Before a PR, run `npm run ci` (lint, type-check, coverage, npm audit, build). Touching `src-tauri` also needs `npm run audit:rust`.
