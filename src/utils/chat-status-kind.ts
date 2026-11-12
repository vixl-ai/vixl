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
  sshNeedsInput?: boolean
}): ChatStatusDisplay => {
  // A chat blocked on the user stays status "running" in its meta (the turn is
  // held open on the gate), so these must win over running or the stall is hidden.
  if (args.attention === 'needs_approval') {
    return { kind: 'needs_approval', label: 'Needs approval' }
  }
  if (args.attention === 'needs_input') {
    return { kind: 'needs_input', label: 'Needs input' }
  }
  if (args.attention === 'needs_mcp_auth') {
    return { kind: 'needs_mcp_auth', label: 'Needs MCP auth' }
  }
  if (args.status === 'running') {
    return { kind: 'running', label: 'Running' }
  }
  if (args.sshNeedsInput) {
    return { kind: 'needs_input', label: 'Needs input' }
  }
  if (args.attention === 'disconnected') {
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
