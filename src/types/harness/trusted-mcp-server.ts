import type { McpServerConfig } from '@/types/vixl/mcp-config'

export type TrustedMcpServerResult =
  | { trusted: true; config: McpServerConfig; scopeKey: string; id: string }
  | { trusted: false; reason: 'missing' | 'untrusted'; error?: string }
