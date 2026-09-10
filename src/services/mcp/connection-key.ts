const connectionKey = (
  scopeKey: string | null | undefined,
  serverId: string,
): string => `${scopeKey?.trim() || 'personal'}\u001f${serverId}`

export default connectionKey
