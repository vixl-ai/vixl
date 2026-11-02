import type { ChatAttention } from '@/types/chat/chat-attention'

export type ChatStatusKind =
  | 'running'
  | 'needs_approval'
  | 'needs_input'
  | 'needs_mcp_auth'
  | 'disconnected'
  | 'completed'
  | 'error'
  | 'idle'

export type ChatStatusDisplay = {
  kind: ChatStatusKind
  label: string
}

export const chatStatusKind = (args: {
  status?: 'idle' | 'running' | string | null
  attention?: ChatAttention
  sshDisconnected?: boolean
  sshNeedsInput?: boolean
}): ChatStatusDisplay => {
  if (args.status === 'running') {
    return { kind: 'running', label: 'Running' }
  }
  if (args.attention === 'needs_approval') {
    return { kind: 'needs_approval', label: 'Needs approval' }
  }
  if (args.attention === 'needs_input' || args.sshNeedsInput) {
    return { kind: 'needs_input', label: 'Needs input' }
  }
  if (args.attention === 'needs_mcp_auth') {
    return { kind: 'needs_mcp_auth', label: 'Needs MCP auth' }
  }
  if (args.attention === 'disconnected' || args.sshDisconnected) {
    return { kind: 'disconnected', label: 'Disconnected' }
  }
  if (args.attention === 'completed') {
    return { kind: 'completed', label: 'Done' }
  }
  if (args.attention === 'error') {
    return { kind: 'error', label: 'Error' }
  }
  return { kind: 'idle', label: 'Idle' }
}
