import type { McpTrustRecord, McpTrustScope } from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import connectionKey from '@/services/mcp/connection-key'

/** connection key -> fingerprint trusted for this app session */
export const sessionTrusts = new Map<string, string>()

export const getMcpTrust = (
  settings: VixlSettings,
  serverId: string,
): McpTrustRecord | undefined =>
  (settings['agent.mcp.trust'] ?? []).find((record) => record.serverId === serverId)

export const isMcpTrusted = (
  settings: VixlSettings,
  serverId: string,
  fingerprint: string,
  trustedInSession: Map<string, string> = sessionTrusts,
  scopeKey?: string | null,
): boolean => {
  if (!fingerprint) {
    return false
  }
  const key = connectionKey(scopeKey, serverId)
  if (trustedInSession.get(key) === fingerprint) {
    return true
  }
  const record = getMcpTrust(settings, serverId)
  if (!record?.fingerprint || record.fingerprint !== fingerprint) {
    return false
  }
  return record.scope === 'always' || record.scope === 'workspace'
}

export const upsertMcpTrustRecord = (
  records: McpTrustRecord[],
  serverId: string,
  scope: McpTrustScope,
  fingerprint: string,
): McpTrustRecord[] => {
  const next: McpTrustRecord = { serverId, scope, fingerprint }
  const existing = records.findIndex((r) => r.serverId === serverId)
  if (existing >= 0) {
    return records.map((r, i) => (i === existing ? next : r))
  }
  return [...records, next]
}

export const clearSessionTrust = (
  serverId: string,
  scopeKey?: string | null,
): void => {
  sessionTrusts.delete(connectionKey(scopeKey, serverId))
}
