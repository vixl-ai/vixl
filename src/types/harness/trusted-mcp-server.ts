import type { McpServerConfig } from '@/types/vixl/mcp-config'

export type TrustedMcpServerResult =
  | { trusted: true; config: McpServerConfig; scopeKey: string }
  | { trusted: false; reason: 'missing' | 'untrusted' }
