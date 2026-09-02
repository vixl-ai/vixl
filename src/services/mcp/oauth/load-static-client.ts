import type { StoredOAuthStaticClient } from '@/types/mcp/stored-oauth-static-client'
import { mcpOAuthStaticClientKey } from '@/services/mcp/mcp-keychain-keys'
import { getSecret } from '@/services/vixl/vixl-tauri'
import parseJson from './parse-json'

const loadStaticOAuthClient = async (
  serverId: string,
): Promise<StoredOAuthStaticClient | undefined> => {
  const stored = parseJson<StoredOAuthStaticClient>(
    await getSecret(mcpOAuthStaticClientKey(serverId)),
  )
  if (!stored?.client_id || stored.client_id.trim().length === 0) {
    return undefined
  }
  const clientId = stored.client_id.trim()
  const secret = stored.client_secret?.trim()
  return {
    client_id: clientId,
    ...(secret && secret.length > 0 ? { client_secret: secret } : {}),
  }
}

export default loadStaticOAuthClient
