import type { StoredOAuthAsInfo } from '@/types/mcp/stored-oauth-as-info'
import { mcpOAuthAsInfoKey } from '@/services/mcp/mcp-keychain-keys'
import { getSecret, setSecret } from '@/services/vixl/vixl-tauri'
import originOf from './origin-of'
import parseJson from './parse-json'

type ValidateAuthorizationServerUrlArgs = {
  serverId: string
  clientId?: string
  allowedAuthorizationServers?: string[]
  confirmAuthorizationServerOrigin?: (origin: string) => Promise<boolean>
  invalidateClientAndTokens: () => Promise<void>
}

const pinAuthorizationServerOrigin = async (
  serverId: string,
  origin: string,
  authorizationServerUrl: string | URL,
): Promise<void> => {
  const existing = parseJson<StoredOAuthAsInfo>(
    await getSecret(mcpOAuthAsInfoKey(serverId)),
  )
  await setSecret(
    mcpOAuthAsInfoKey(serverId),
    JSON.stringify({
      ...existing,
      origin,
      authorizationServerUrl: String(authorizationServerUrl),
      tokenEndpoint: existing?.tokenEndpoint ?? '',
      issuer: existing?.issuer,
    }),
  )
}

const isAllowlisted = (
  allowedAuthorizationServers: string[] | undefined,
  asOrigin: string,
): boolean => {
  if (!allowedAuthorizationServers || allowedAuthorizationServers.length === 0) {
    return false
  }
  return allowedAuthorizationServers.some((entry) => originOf(entry) === asOrigin)
}

const pinnedOriginOf = (stored: StoredOAuthAsInfo | undefined): string | undefined =>
  stored?.origin ??
  (stored?.issuer ? originOf(stored.issuer) : undefined) ??
  (stored?.authorizationServerUrl
    ? originOf(stored.authorizationServerUrl)
    : undefined)

const createValidateAuthorizationServerUrl = (
  args: ValidateAuthorizationServerUrlArgs,
) => {
  const {
    serverId,
    clientId,
    allowedAuthorizationServers,
    confirmAuthorizationServerOrigin,
    invalidateClientAndTokens,
  } = args

  return async (
    mcpServerUrl: string | URL,
    authorizationServerUrl: string | URL,
  ): Promise<void> => {
    const asOrigin = originOf(authorizationServerUrl)
    const allowlisted = isAllowlisted(allowedAuthorizationServers, asOrigin)

    if (allowedAuthorizationServers && allowedAuthorizationServers.length > 0 && !allowlisted) {
      throw new Error(
        `Authorization server origin ${asOrigin} is not in the allowlist`,
      )
    }

    const stored = parseJson<StoredOAuthAsInfo>(
      await getSecret(mcpOAuthAsInfoKey(serverId)),
    )
    const pinnedOrigin = pinnedOriginOf(stored)

    if (pinnedOrigin && pinnedOrigin !== asOrigin) {
      if (clientId) {
        throw new Error(
          'Configured OAuth client is bound to a different authorization server issuer',
        )
      }
      await invalidateClientAndTokens()
    } else if (pinnedOrigin) {
      return
    }

    if (allowlisted) {
      await pinAuthorizationServerOrigin(serverId, asOrigin, authorizationServerUrl)
      return
    }

    const mcpOrigin = originOf(mcpServerUrl)
    if (mcpOrigin === asOrigin) {
      await pinAuthorizationServerOrigin(serverId, asOrigin, authorizationServerUrl)
      return
    }

    const confirmed = confirmAuthorizationServerOrigin
      ? await confirmAuthorizationServerOrigin(asOrigin)
      : false
    if (!confirmed) {
      throw new Error(
        `Authorization server origin ${asOrigin} was not confirmed`,
      )
    }

    await pinAuthorizationServerOrigin(serverId, asOrigin, authorizationServerUrl)
  }
}

export default createValidateAuthorizationServerUrl
