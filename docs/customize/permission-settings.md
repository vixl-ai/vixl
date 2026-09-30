---
title: Permission settings
description: Change the Vixl permission dial default, sandbox, auto-approve globs, and persisted allow or deny rows.
---

# Permission settings

The shield under the [chat input](/getting-started/your-first-chat) is the permission dial. Settings > Permissions holds the sandbox switches and the personal allow/deny list. What Ask, Allowlist, and Bypass mean is on [Permissions and approvals](/concepts/permissions-and-approvals).

## Change the default dial

The default is Allowlist (`agent.permissionLevel`). On a live thread, changing the dial writes that personal setting, so later chats start at the same level.

::: warning
Bypass skips prompts for file, shell, git, web, and MCP actions. Sensitive paths and denied capabilities still block or ask. Confirm **Enable bypass** only when you trust the current task.
:::

## Auto-approve globs

There is no glob editor in Settings. `agent.autoApproveGlobs` lives in [settings.json](/reference/settings-json) (default empty). Personal and project lists are unioned. When every path on a filesystem write or delete matches, that action auto-approves. Matching globs also auto-approve those writes when the dial is Ask.

## Sandbox

Settings > Permissions has **Sandbox terminal** (`agent.sandbox.enabled`, default on). Sandboxed commands can auto-run. Leaving the sandbox always asks. **Sandbox network** is Deny or Allow (`agent.sandbox.network`, default Allow). The network control is disabled when sandbox is off.

OS sandboxing is separate from the permission dial. Unsandboxed or network hops still go through Ask, Allowlist, or Bypass.

## Allow and deny records

Settings does not add rows. They appear after you approve or deny in chat with a persist scope.

- **Always** writes personal `agent.permissions` and shows up here.
- **Workspace** writes the project's `settings.json`. Home chats have no project, so workspace persist is refused. Those project rows do not appear in Settings > Permissions.
- Once and session do not persist.

Shell persist scopes are once, session, and never only. They never become Settings rows.

The list is grouped as Filesystem, Shell, Git, MCP, and Web. Remove one row, or **Clear all** to empty the personal list. That is how you take back a persisted allow or deny.

Personal `deny` wins when personal and project records share a capability. See [the `.vixl` directory](/concepts/the-vixl-directory) for the merge.

MCP server trust is separate: see [MCP servers](/customize/mcp-servers). A trusted server still passes `mcp.call` through this dial.
