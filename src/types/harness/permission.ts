export type ApprovalKind = 'fs' | 'shell' | 'git' | 'mcp' | 'browser' | 'web'

export type PermissionAction =
  | 'fs.write'
  | 'fs.delete'
  | 'shell'
  | 'shell.network'
  | 'shell.unsandboxed'
  | 'git.write'
  | 'mcp.call'
  | 'browser.navigate'
  | 'browser.interact'
  | 'browser.cdp'
  | 'web.fetch'

export type PermissionVerdict = 'allow' | 'ask' | 'deny'

export type PermissionScope = 'once' | 'session' | 'workspace' | 'always' | 'never'

export type PermissionLevel = 'ask' | 'allowlist' | 'bypass'

export type PermissionCapabilityKey =
  | `fs.write:${string}`
  | `fs.delete:${string}`
  | 'shell'
  | 'shell.network'
  | 'shell.unsandboxed'
  | 'git.commit'
  | 'git.checkout'
  | 'git.branch_create'
  | `mcp:${string}`
  | `mcp:${string}:${string}`
  | 'browser.navigate'
  | 'browser.interact'
  | 'browser.cdp'
  | 'browser'
  | 'web.fetch'
  | `web.fetch:${string}`

export type PermissionRecord = {
  capability: PermissionCapabilityKey
  verdict: 'allow' | 'deny'
  scope: 'workspace' | 'always'
}

export type McpTrustScope = 'session' | 'workspace' | 'always' | 'never'

export type McpTrustRecord = {
  serverId: string
  scope: McpTrustScope
  /** Hash of transport identity (url or command+args). Missing = untrusted until re-granted. */
  fingerprint?: string
}
