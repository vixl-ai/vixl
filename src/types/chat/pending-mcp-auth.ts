import type { McpAuthKind } from '@/services/mcp/mcp-auth-gate'

export type PendingMcpAuthView = {
  chatId: string
  toolCallId: string
  serverId: string
  scopeKey: string
  kind: McpAuthKind
  title: string
  detail?: string
  subagentId?: string
  subagentLabel?: string
}
