import type { StoredOAuthStaticClient } from '@/types/mcp/stored-oauth-static-client'
import { mcpOAuthStaticClientKey } from '@/services/mcp/mcp-keychain-keys'
import { setSecret } from '@/services/vixl/vixl-tauri'

const saveStaticOAuthClient = async (
  serverId: string,
  client: StoredOAuthStaticClient,
): Promise<void> => {
  const clientId = client.client_id.trim()
  if (clientId.length === 0) {
    throw new Error('OAuth client ID is required')
  }
  const secret = client.client_secret?.trim()
  const payload: StoredOAuthStaticClient = {
    client_id: clientId,
    ...(secret && secret.length > 0 ? { client_secret: secret } : {}),
  }
  await setSecret(mcpOAuthStaticClientKey(serverId), JSON.stringify(payload))
}

export default saveStaticOAuthClient
