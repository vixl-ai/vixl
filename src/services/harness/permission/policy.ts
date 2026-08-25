import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type {
  PermissionAction,
  PermissionCapabilityKey,
  PermissionLevel,
  PermissionRecord,
  PermissionScope,
  PermissionVerdict,
} from '@/types/harness/permission'
import {
  matchesAutoApproveGlob,
  shouldAutoApprove,
} from '@/services/harness/permission/approval-gate'

export type PermissionDecisionInput = {
  action: PermissionAction
  capability: PermissionCapabilityKey
  paths?: string[]
  settings: VixlSettings
  permissionLevel: PermissionLevel
  sessionAllows: Set<string>
  sessionDenies: Set<string>
  sandboxEnabled: boolean
}

export type PermissionDecision = {
  verdict: PermissionVerdict
  allowedScopes: PermissionScope[]
  reason?: string
}

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env(\.|$|\/)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  /(^|\/)\.gnupg(\/|$)/i,
  /(^|\/)\.netrc(\/|$)/i,
  /(^|\/)\.npmrc(\/|$)/i,
  /(^|\/)\.pypirc(\/|$)/i,
  /(^|\/)\.kube\/config$/i,
  /(^|\/)\.docker\/config\.json$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /credential/i,
  /secret/i,
  /password/i,
  /\.(pem|key|p12|pfx|jks)$/i,
]

export const isSensitivePath = (path: string): boolean =>
  SENSITIVE_PATH_PATTERNS.some((pattern) => pattern.test(path))

/** Once-approvals for these hop onto sessionAllows for the rest of the stream. */
export const isStickyShellElevation = (
  capability: PermissionCapabilityKey,
): boolean => capability === 'shell.network' || capability === 'shell.unsandboxed'

export const sessionAllowsUnsandboxed = (sessionAllows: Set<string>): boolean =>
  sessionAllows.has('shell.unsandboxed')

export const sessionAllowsNetwork = (sessionAllows: Set<string>): boolean =>
  sessionAllows.has('shell.network') || sessionAllowsUnsandboxed(sessionAllows)

export const parsePermissionRecords = (
  value: unknown,
): PermissionRecord[] => {
  if (!Array.isArray(value)) {
    return []
  }
  const records: PermissionRecord[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue
    }
    const record = item as Record<string, unknown>
    if (
      typeof record.capability === 'string' &&
      (record.verdict === 'allow' || record.verdict === 'deny') &&
      (record.scope === 'workspace' || record.scope === 'always')
    ) {
      records.push({
        capability: record.capability as PermissionCapabilityKey,
        verdict: record.verdict,
        scope: record.scope,
      })
    }
  }
  return records
}

const findPersisted = (
  capability: PermissionCapabilityKey,
  settings: VixlSettings,
): PermissionRecord | undefined => {
  const records = parsePermissionRecords(settings['agent.permissions'])
  return records.find((record) => record.capability === capability)
}

const shellScopesPhaseA = (): PermissionScope[] => ['once', 'session', 'never']

const defaultScopes = (): PermissionScope[] => [
  'once',
  'session',
  'workspace',
  'always',
  'never',
]

export const decidePermission = (input: PermissionDecisionInput): PermissionDecision => {
  const {
    action,
    capability,
    paths = [],
    settings,
    permissionLevel,
    sessionAllows,
    sessionDenies,
    sandboxEnabled,
  } = input

  if (sessionDenies.has(capability)) {
    return { verdict: 'deny', allowedScopes: [], reason: 'Denied for this session' }
  }

  const persisted = findPersisted(capability, settings)
  if (persisted?.verdict === 'deny') {
    return { verdict: 'deny', allowedScopes: [], reason: 'Permanently denied' }
  }

  if (
    action === 'shell' ||
    action === 'shell.network' ||
    action === 'shell.unsandboxed'
  ) {
    // Shell is never covered by Bypass. Approval scopes are once/session/never only
    // (no workspace/always persist). OS sandboxing (Seatbelt / bwrap) is separate from
    // this permission gate; sandboxed vs unsandboxed is chosen at spawn time.
    // Session allow of `shell` must not cover `shell.network` or `shell.unsandboxed`.
    // Session allow of `shell.unsandboxed` may cover network and sandboxed shell
    // (full access implies network). Session allow of `shell.network` covers only
    // that hop, not unsandboxed.
    const sessionAllowed =
      action === 'shell.unsandboxed'
        ? sessionAllowsUnsandboxed(sessionAllows)
        : action === 'shell.network'
          ? sessionAllowsNetwork(sessionAllows)
          : sessionAllows.has('shell') || sessionAllowsUnsandboxed(sessionAllows)
    if (sessionAllowed) {
      return { verdict: 'allow', allowedScopes: shellScopesPhaseA() }
    }
    return {
      verdict: 'ask',
      allowedScopes: shellScopesPhaseA(),
      reason: sandboxEnabled ? undefined : 'Unsandboxed shell',
    }
  }

  if (action === 'web.fetch') {
    // Web fetch is never covered by Bypass. Session/workspace/always persist allowed.
    if (sessionAllows.has(capability) || sessionAllows.has('web.fetch')) {
      return { verdict: 'allow', allowedScopes: defaultScopes() }
    }
    if (persisted?.verdict === 'allow') {
      return { verdict: 'allow', allowedScopes: defaultScopes() }
    }
    return { verdict: 'ask', allowedScopes: defaultScopes(), reason: 'Web fetch' }
  }

  // Sensitive-path check must win over persisted allow, session allow, and bypass.
  // This guard is intentionally placed before all three so none can short-circuit it.
  if (paths.some(isSensitivePath)) {
    return {
      verdict: 'ask',
      allowedScopes: defaultScopes(),
      reason: 'Sensitive path',
    }
  }

  if (persisted?.verdict === 'allow') {
    return { verdict: 'allow', allowedScopes: defaultScopes() }
  }

  if (sessionAllows.has(capability)) {
    return { verdict: 'allow', allowedScopes: defaultScopes() }
  }

  if (permissionLevel === 'bypass') {
    if (action === 'fs.write' || action === 'fs.delete') {
      return { verdict: 'allow', allowedScopes: defaultScopes() }
    }
    if (action === 'git.write') {
      return { verdict: 'allow', allowedScopes: defaultScopes() }
    }
  }

  if (
    (action === 'fs.write' || action === 'fs.delete') &&
    shouldAutoApprove(paths, settings['agent.autoApproveGlobs'] ?? [])
  ) {
    return { verdict: 'allow', allowedScopes: defaultScopes() }
  }

  if (permissionLevel === 'allowlist') {
    const globs = settings['agent.autoApproveGlobs'] ?? []
    if (
      (action === 'fs.write' || action === 'fs.delete') &&
      paths.length > 0 &&
      paths.every((path) => matchesAutoApproveGlob(path, globs))
    ) {
      return { verdict: 'allow', allowedScopes: defaultScopes() }
    }
    return { verdict: 'ask', allowedScopes: defaultScopes() }
  }

  return { verdict: 'ask', allowedScopes: defaultScopes() }
}

export const fsWriteCapability = (path: string): PermissionCapabilityKey =>
  `fs.write:${path}`

export const fsDeleteCapability = (path: string): PermissionCapabilityKey =>
  `fs.delete:${path}`

export const mcpCapability = (
  serverId: string,
  toolName?: string,
): PermissionCapabilityKey =>
  toolName ? `mcp:${serverId}:${toolName}` : `mcp:${serverId}`
