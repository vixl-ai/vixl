import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'

const normalizeArgs = (args: string[] | undefined): string[] =>
  (args ?? []).map((arg) => arg.trim())

const fingerprintPayload = (config: McpServerConfig): string => {
  if (isMcpHttpServer(config)) {
    return JSON.stringify({
      kind: 'http',
      type: config.type,
      url: config.url.trim(),
    })
  }
  if (isMcpStdioServer(config)) {
    return JSON.stringify({
      kind: 'stdio',
      command: config.command.trim(),
      args: normalizeArgs(config.args),
    })
  }
  return JSON.stringify({ kind: 'unknown' })
}

/** Sync FNV-1a 64-bit hex fingerprint of transport identity (url or command+args). */
export const mcpServerFingerprint = (config: McpServerConfig): string => {
  const payload = fingerprintPayload(config)
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= BigInt(payload.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}
