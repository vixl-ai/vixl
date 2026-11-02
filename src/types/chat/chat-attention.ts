export type ChatAttention =
  | 'needs_approval'
  | 'needs_input'
  | 'needs_mcp_auth'
  | 'disconnected'
  | 'completed'
  | 'error'
  | null
