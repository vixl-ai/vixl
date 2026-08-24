const PREFIX = 'vixl:mcp:'

export const mcpOAuthTokensKey = (serverId: string): string =>
  `${PREFIX}${serverId}:oauth:tokens`

export const mcpOAuthVerifierKey = (serverId: string): string =>
  `${PREFIX}${serverId}:oauth:verifier`

export const mcpOAuthClientKey = (serverId: string): string =>
  `${PREFIX}${serverId}:oauth:client`

export const mcpOAuthStateKey = (serverId: string): string =>
  `${PREFIX}${serverId}:oauth:state`

export const mcpOAuthAsInfoKey = (serverId: string): string =>
  `${PREFIX}${serverId}:oauth:as`

export const mcpInputKey = (serverId: string, inputId: string): string =>
  `${PREFIX}${serverId}:input:${inputId}`

export const mcpKnownSecretKeys = (
  serverId: string,
  inputIds: string[] = [],
): string[] => [
  mcpOAuthTokensKey(serverId),
  mcpOAuthVerifierKey(serverId),
  mcpOAuthClientKey(serverId),
  mcpOAuthStateKey(serverId),
  mcpOAuthAsInfoKey(serverId),
  ...inputIds.map((inputId) => mcpInputKey(serverId, inputId)),
]
