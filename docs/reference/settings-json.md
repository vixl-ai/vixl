---
title: settings.json
description: Every settings.json key, type, default, and whether a project file can override it.
---

# settings.json

`settings.json` is the on-disk store for theme, models, permissions, sandbox, MCP trust, and similar preferences. Personal settings live at `{app data}/.vixl/settings.json`. A project can add `<repo>/.vixl/settings.json` to overlay some of those keys. API keys never go in this file; they stay in the OS keychain. Paths: [.vixl layout](/reference/vixl-layout). Keys: [Providers](/customize/providers).

The file is a JSON object with `"version": 1`. A missing or empty file loads as the defaults below. An invalid file, or one whose `version` is not `1`, also loads as those defaults. Unknown keys that still parse as a string, number, boolean, array, or custom provider object are kept. Deprecated keys (`agent.defaultProvider`, `agent.defaultModel`, `chat.autoTitleModel`, `agent.defaultMode`, `fleet.maxConcurrentAgents`, `fleet.trayBackground`, `general.machineLabel`) are dropped on load.

## Personal vs project

Home chats use the personal file only. Project chats merge personal settings with that project's file.

Project values replace personal values for most keys that appear in the project file. Keys that start with `providers.`, `models.`, or `lsp.` are personal only. If they appear in a project file, Vixl strips them and rewrites the file.

These keys merge instead of replace:

| Key | Merge |
| --- | --- |
| `agent.mcp.trust` | Union by `serverId`. Personal `never` wins. Otherwise the project record wins. |
| `agent.permissions` | Union by `capability`. Personal `deny` wins, then project `deny`, otherwise the project record. |
| `agent.autoApproveGlobs` | Union of both string lists, personal first, duplicates dropped. |

A project file that fails to parse contributes no overrides (the personal file still applies). Keys omitted from the project file keep the personal value.

## Keys

Scope is **personal** (ignored and stripped from a project file) or **overridable** (a project value replaces the personal one, except the three merge keys above).

| Key | Type | Default | Scope |
| --- | --- | --- | --- |
| `version` | `1` | `1` | Required in both files |
| `appearance.theme` | `"light"` \| `"dark"` \| `"system"` | `"system"` | Overridable |
| `appearance.transparency` | boolean | `true` | Overridable |
| `appearance.transparencyHue` | number 0 to 360 | `265` | Overridable |
| `appearance.transparencyIntensity` | number 0 to 100 | `0` | Overridable |
| `agent.autoApproveGlobs` | string[] | `[]` | Union |
| `agent.permissionLevel` | `"ask"` \| `"allowlist"` \| `"bypass"` | `"allowlist"` | Overridable |
| `agent.permissions` | permission records | `[]` | Union by capability |
| `agent.mcp.trust` | trust records | `[]` | Union by serverId |
| `agent.sandbox.enabled` | boolean | `true` | Overridable |
| `agent.sandbox.network` | `"deny"` \| `"allow"` | `"allow"` | Overridable |
| `lsp.autoDownload` | boolean | `true` | Personal |
| `workspace.trust` | `{ rootPath, trusted }[]` | `[]` | Overridable (replaces the whole array) |
| `chat.autoTitle` | boolean | `true` | Overridable |
| `workbench.duplicateTabBehavior` | `"ask"` \| `"open-existing"` \| `"open-new"` | `"ask"` | Overridable |
| `models.default` | model ref | unset | Personal |
| `models.ask` | model ref | unset | Personal |
| `models.plan` | model ref | unset | Personal |
| `models.agent` | model ref | unset | Personal |
| `models.orchestrator` | model ref | unset | Personal |
| `models.subagent` | model ref | unset | Personal |
| `models.title` | model ref | unset | Personal |
| `models.*Reasoning` | reasoning level | unset | Personal |
| `models.catalogOptions` | map of model ref to options | unset | Personal |
| `models.catalogMeta` | map of model ref to catalog meta | unset | Personal |
| `providers.<id>.apiKeyRef` | string | unset | Personal |
| `providers.custom.<id>` | custom provider object | unset | Personal |

Model fields have no defaults. First run has no providers and no default model. See [Models and roles](/concepts/models-and-roles).

## Appearance

`appearance.theme` follows Light, Dark, or the OS. `appearance.transparency` turns window transparency on. When it is on, `appearance.transparencyHue` (0 to 360) and `appearance.transparencyIntensity` (0 to 100) set the tint. Edit these in [Appearance](/customize/appearance).

## Agent, sandbox, and permissions

`agent.permissionLevel` is the chat permission dial: Ask, Allowlist, or Bypass. See [Permissions and approvals](/concepts/permissions-and-approvals).

`agent.permissions` is the persisted allow and deny list. Each record is:

```json
{
  "capability": "fs.write",
  "verdict": "allow",
  "scope": "workspace"
}
```

`capability` is a string such as `fs.write`, `fs.delete`, `fs.write:<path>`, `fs.delete:<path>`, `shell`, `shell.network`, `shell.unsandboxed`, `git.commit`, `git.checkout`, `git.branch_create`, `mcp:<serverId>`, `mcp:<serverId>:<tool>`, `web.fetch`, `web.fetch:<host>`, or `workspace.move`. `verdict` is `"allow"` or `"deny"`. `scope` on disk is `"workspace"` or `"always"` (once and session are not persisted).

`agent.autoApproveGlobs` auto-approves filesystem writes and deletes when every path matches at least one glob (dotfiles included). There is no Settings form for this list. Edit the JSON. An empty list means those actions still ask (unless Bypass already allows them).

`agent.sandbox.enabled` sandboxes agent terminal commands. `agent.sandbox.network` is `"allow"` or `"deny"` for network inside that sandbox. Leaving the sandbox always asks. See [Permission settings](/customize/permission-settings).

## MCP trust

`agent.mcp.trust` records whether a server may start. Each record is:

```json
{
  "serverId": "github",
  "scope": "always",
  "fingerprint": "ab12cd34ef56ab78"
}
```

`scope` is `"session"` \| `"workspace"` \| `"always"` \| `"never"`. `fingerprint` is a hash of the command plus args (stdio) or of the transport type plus URL (HTTP/SSE). Missing fingerprint means untrusted until granted again. Changing command, args, URL, or HTTP vs SSE requires trust again. See [mcp.json](/reference/mcp-json).

## Workspace trust

`workspace.trust` is an array of `{ "rootPath": string, "trusted": boolean }`. Project-local language servers that require trust (ESLint, Oxlint, Biome) check this list against the canonical project root.

## Models

Each role stores a model ref `providerId::modelId`. Optional reasoning for that role is a separate field.

| Field | Role |
| --- | --- |
| `models.default` | Fallback for every role |
| `models.ask` | Ask mode |
| `models.plan` | Plan mode |
| `models.agent` | Agent mode |
| `models.orchestrator` | Orchestrator parent |
| `models.subagent` | Nested sub-agent default |
| `models.title` | Background chat titles |

Reasoning fields: `models.defaultReasoning`, `models.askReasoning`, `models.planReasoning`, `models.agentReasoning`, `models.orchestratorReasoning`, `models.subagentReasoning`, `models.titleReasoning`. Allowed values: `"provider-default"`, `"none"`, `"minimal"`, `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`.

`models.catalogOptions` is a map from model ref to `{ reasoning?, fast?, allowed?, contextWindow?, maxOutputTokens? }`. `models.catalogMeta` is a map from model ref to `{ contextWindow?, maxOutputTokens?, pricing?, fastPricing?, vision?, toolCalling? }`. Pricing uses USD per million tokens: `inputPerMillion`, `outputPerMillion`, optional `cacheReadPerMillion`, `cacheWritePerMillion`, `reasoningPerMillion`.

`chat.autoTitle` turns background title generation on. Edit roles in [Models](/customize/models).

## Providers

Catalog providers store only a keychain pointer:

```json
"providers.openai.apiKeyRef": "openai"
```

The secret itself is `vixl:provider:<apiKeyRef>` in the keychain. See [Providers](/customize/providers).

Custom OpenAI-compatible endpoints use `providers.custom.<id>`:

```json
{
  "type": "openai-compatible",
  "name": "local",
  "baseURL": "http://localhost:1234/v1",
  "apiKeyRef": "local",
  "headers": {},
  "queryParams": {},
  "includeUsage": true,
  "supportsStructuredOutputs": false,
  "models": []
}
```

`type` must be `"openai-compatible"`. `name` is required. `baseURL` must be a URL. `apiKeyRef`, `headers`, `queryParams`, `includeUsage`, `supportsStructuredOutputs`, and `models` are optional. When `includeUsage` is omitted, Vixl treats it as `true`. Each model object requires `id` and may set `name`, `maxInputTokens`, `maxOutputTokens`, `contextWindow`, `toolCalling`, `vision`, `thinking`, `streaming`, `supportsReasoningEffort`, `reasoningEffort`, `temperature` (0 to 2), `topP` (0 to 1), `topK`, `frequencyPenalty` (-2 to 2), `presencePenalty` (-2 to 2), `seed`, `headers`, `modelOptions`, `pricing`, and `fastPricing`.

## Other fields

`lsp.autoDownload` downloads default language support when a project is activated. Disable it for airgapped machines. Server install state lives in personal `lsp.json`, not here. See [Language servers](/customize/language-servers) and [Managed components](/reference/managed-components).

`workbench.duplicateTabBehavior` controls what happens when you open a **Terminal** or **Changes** tab that is already open for that project: ask, reuse the existing tab, or open a new one. Editor tabs do not use this setting: there is one editor tab per project, and opening a file adds it there.

## Example

```json
{
  "version": 1,
  "appearance.theme": "system",
  "appearance.transparency": true,
  "models.default": "anthropic::claude-sonnet-4-5",
  "models.agent": "anthropic::claude-sonnet-4-5",
  "agent.permissionLevel": "allowlist",
  "agent.autoApproveGlobs": ["src/**", "docs/**"],
  "agent.sandbox.enabled": true,
  "agent.sandbox.network": "allow",
  "chat.autoTitle": true,
  "workbench.duplicateTabBehavior": "ask",
  "lsp.autoDownload": true,
  "agent.mcp.trust": [
    { "serverId": "github", "scope": "always", "fingerprint": "ab12cd34ef56ab78" }
  ],
  "workspace.trust": [
    { "rootPath": "/Users/you/src/vixl", "trusted": true }
  ]
}
```

See [mcp.json](/reference/mcp-json) for MCP server configs and [.vixl layout](/reference/vixl-layout) for every path.
