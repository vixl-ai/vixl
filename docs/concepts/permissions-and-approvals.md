---
title: Permissions and approvals
description: The Vixl permission dial is Ask, Allowlist, or Bypass, and it decides which tools may run without asking you.
---

# Permissions and approvals

The shield under the chat input is the permission dial: Ask, Allowlist, or Bypass. The default is Allowlist. Changing the dial on a live thread also writes that personal setting.

[Chat modes](/concepts/chat-modes) decide which tools exist. This dial decides whether a tool that wants to write, run shell, touch git, fetch the web, or call [MCP](https://modelcontextprotocol.io/) may proceed without asking you. How to change the dial, sandbox switches, and persisted rows is on [Permission settings](/customize/permission-settings).

## Dial levels

**Ask** prompts before each write, shell, git, web, or MCP action.

**Allowlist** auto-approves filesystem writes and deletes whose paths all match `agent.autoApproveGlobs` in `settings.json`. Everything else asks. Those globs also auto-approve matching filesystem writes when the dial is Ask. There is no Settings form for the glob list. An empty list means every matching action asks.

**Bypass** skips prompts for file, shell, git, web, and MCP. Switching to Bypass asks you to confirm. Sensitive paths still ask. Denied capabilities still deny. `move_workspace` still asks, once only.

## Approval scopes

When Vixl asks, the card offers the scopes the policy allows:

- **Allow once** (or **Run outside sandbox** when the command is unsandboxed)
- **Allow session**
- **Allow workspace** (filesystem prefers this first: **Allow file edits in this workspace**)
- **Always allow**
- **Deny**
- **Never**

Once applies to this call. Session lasts for the rest of the stream. Workspace writes `agent.permissions` on the project's `settings.json`. Always writes the same key on personal `settings.json`. Never is a session deny plus a persisted deny.

Home chats have no project, so a workspace persist is refused.

Shell, including network and unsandboxed hops, only offers once, session, and never. Those records do not persist as workspace or always. Approving once for `shell.network` or `shell.unsandboxed` sticks onto the session. A session allow of `shell` does not cover network or unsandboxed. A session allow of `shell.unsandboxed` covers network and sandboxed shell.

`move_workspace` is once only. Bypass does not auto-allow it.

## What still asks

Deny wins first (session or persisted), then the action-specific rules.

Sensitive paths always ask, including under Bypass: `.env`, `.ssh`, `.aws`, `.gnupg`, `.netrc`, `.npmrc`, `.pypirc`, kube and docker config, private keys, names that match credential, secret, or password, and suffixes `.pem`, `.key`, `.p12`, `.pfx`, `.jks`.

## Sandbox

OS sandbox is a jail around the command, separate from the dial. **Sandbox terminal** (default on) runs shell commands in that jail when the platform supports it. Unsandboxed hops still go through the permission gate. **Sandbox network** is Deny or Allow (default Allow) and controls whether sandboxed commands may use the network.

## MCP trust and workspace trust

MCP trust is also separate from the dial. An untrusted server cannot start or be called, even in Bypass. Trust choices are This session, This workspace, Always, Never. Trust is tied to the command, args, or URL. Changing those requires trust again. Personal `never` wins the merge. How to add and trust servers is on [MCP servers](/customize/mcp-servers).

Workspace trust is a personal list of folder roots (`workspace.trust`). Project-local language servers that require it (ESLint, Oxlint, Biome) will not start until that folder is marked trusted. It is not the permission dial. See [Language servers](/customize/language-servers).

Persisted allow and deny rows from chat show up in Settings, grouped as Filesystem, Shell, Git, MCP, and Web. You can remove a row or clear them. You cannot add rows there. They appear after you approve or deny in chat.
