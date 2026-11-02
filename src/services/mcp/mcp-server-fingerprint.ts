import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'

const normalizeArgs = (args: string[] | undefined): string[] =>
  (args ?? []).map((arg) => arg.trim())

export const sshUserHostFromScope = (scopeKey?: string | null): string | undefined => {
  const trimmed = scopeKey?.trim()
  if (!trimmed?.startsWith('ssh://')) {
    return undefined
  }
  try {
    const url = new URL(trimmed)
    const user = url.username
    const host = url.hostname
    if (!host) {
      return undefined
    }
    return user ? `${user}@${host}` : host
  } catch {
    return undefined
  }
}

const fingerprintPayload = (config: McpServerConfig, scopeKey?: string | null): string => {
  if (isMcpHttpServer(config)) {
    return JSON.stringify({
      kind: 'http',
      type: config.type,
      url: config.url.trim(),
    })
  }
  if (isMcpStdioServer(config)) {
    const userHost = sshUserHostFromScope(scopeKey)
    return JSON.stringify({
      kind: 'stdio',
      command: config.command.trim(),
      args: normalizeArgs(config.args),
      ...(userHost ? { userHost } : {}),
    })
  }
  return JSON.stringify({ kind: 'unknown' })
}

/** Sync FNV-1a 64-bit hex fingerprint of transport identity (url or command+args). */
export const mcpServerFingerprint = (
  config: McpServerConfig,
  scopeKey?: string | null,
): string => {
  const payload = fingerprintPayload(config, scopeKey)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= BigInt(payload.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
