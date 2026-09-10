export type McpAuthKind = 'oauth' | 'inputs' | 'trust' | 'client'

export type McpAuthResolution =
  | { action: 'authenticated' }
  | { action: 'skipped' }
  | { action: 'cancelled' }

export type PendingMcpAuth = {
  chatId: string
  toolCallId: string
  serverId: string
  scopeKey: string
  kind: McpAuthKind
  title: string
  detail?: string
  subagentId?: string
  subagentLabel?: string
  resolve: (result: McpAuthResolution) => void
}

const resolvedAuthScope = (scopeKey?: string | null): string =>
  scopeKey?.trim() || 'personal'

const pending = new Map<string, PendingMcpAuth>()

export const requestMcpAuth = (
  entry: Omit<PendingMcpAuth, 'resolve'>,
): Promise<McpAuthResolution> =>
  new Promise((resolve) => {
    pending.set(entry.toolCallId, { ...entry, resolve })
  })

export const getPendingMcpAuth = (toolCallId: string): PendingMcpAuth | undefined =>
  pending.get(toolCallId)

export const listPendingMcpAuthForChat = (chatId: string): PendingMcpAuth[] =>
  [...pending.values()].filter((entry) => entry.chatId === chatId)

export const listPendingMcpAuthForServer = (
  serverId: string,
  scopeKey?: string | null,
): PendingMcpAuth[] => {
  const wanted = resolvedAuthScope(scopeKey)
  return [...pending.values()].filter(
    (entry) =>
      entry.serverId === serverId && resolvedAuthScope(entry.scopeKey) === wanted,
  )
}

export const resolveMcpAuth = (toolCallId: string, result: McpAuthResolution): void => {
  const entry = pending.get(toolCallId)
  if (!entry) {
    return
  }
  pending.delete(toolCallId)
  entry.resolve(result)
}

export const resolveMcpAuthForServer = (
  serverId: string,
  result: McpAuthResolution,
  scopeKey?: string | null,
): void => {
  for (const entry of listPendingMcpAuthForServer(serverId, scopeKey)) {
    resolveMcpAuth(entry.toolCallId, result)
  }
}

export const patchPendingMcpAuthForServer = (
  serverId: string,
  patch: Partial<Pick<PendingMcpAuth, 'kind' | 'detail' | 'title'>>,
  scopeKey?: string | null,
): void => {
  for (const entry of listPendingMcpAuthForServer(serverId, scopeKey)) {
    if (patch.kind) {
      entry.kind = patch.kind
    }
    if (patch.detail !== undefined) {
      entry.detail = patch.detail
    }
    if (patch.title) {
      entry.title = patch.title
    }
  }
}

export const rejectPendingMcpAuthForChat = (chatId: string): void => {
  for (const entry of listPendingMcpAuthForChat(chatId)) {
    pending.delete(entry.toolCallId)
    entry.resolve({ action: 'cancelled' })
  }
}

export const resetMcpAuthGateForTests = (): void => {
  pending.clear()
}
