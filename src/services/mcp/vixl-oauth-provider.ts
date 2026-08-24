import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientProvider,
  OAuthTokens,
} from '@ai-sdk/mcp'
import {
  mcpOAuthAsInfoKey,
  mcpOAuthClientKey,
  mcpOAuthStateKey,
  mcpOAuthTokensKey,
  mcpOAuthVerifierKey,
} from '@/services/mcp/mcp-keychain-keys'
import { deleteSecret, getSecret, setSecret } from '@/services/vixl/vixl-tauri'

type CreateVixlOAuthProviderArgs = {
  serverId: string
  serverUrl: string
  clientId?: string
  allowedAuthorizationServers?: string[]
  redirectUrl: string
  openUrl: (url: string, allowedOrigin: string) => void | Promise<void>
  /** Required when no allowlist and no pinned AS: user must confirm the AS origin. */
  confirmAuthorizationServerOrigin?: (origin: string) => Promise<boolean>
}

const originOf = (value: string | URL): string => {
  const url = typeof value === 'string' ? new URL(value) : value
  return url.origin
}

const parseJson = <T>(raw: string | null): T | undefined => {
  if (raw === null || raw.length === 0) {
    return undefined
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

const randomHex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export const createVixlOAuthProvider = (
  args: CreateVixlOAuthProviderArgs,
): OAuthClientProvider => {
  const {
    serverId,
    clientId,
    allowedAuthorizationServers,
    redirectUrl,
    openUrl,
    confirmAuthorizationServerOrigin,
  } = args

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl
    },

    get clientMetadata() {
      return {
        client_name: 'Vixl',
        redirect_uris: [redirectUrl],
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
      }
    },

    tokens: async (): Promise<OAuthTokens | undefined> =>
      parseJson<OAuthTokens>(await getSecret(mcpOAuthTokensKey(serverId))),

    saveTokens: async (tokens: OAuthTokens): Promise<void> => {
      await setSecret(mcpOAuthTokensKey(serverId), JSON.stringify(tokens))
    },

    saveCodeVerifier: async (codeVerifier: string): Promise<void> => {
      await setSecret(mcpOAuthVerifierKey(serverId), codeVerifier)
    },

    codeVerifier: async (): Promise<string> => {
      const stored = await getSecret(mcpOAuthVerifierKey(serverId))
      if (stored === null || stored.length === 0) {
        throw new Error('Missing OAuth PKCE code verifier')
      }
      return stored
    },

    clientInformation: async (): Promise<OAuthClientInformation | undefined> => {
      const stored = parseJson<OAuthClientInformation>(
        await getSecret(mcpOAuthClientKey(serverId)),
      )
      if (stored) {
        return stored
      }
      if (clientId) {
        return { client_id: clientId }
      }
      return undefined
    },

    saveClientInformation: async (
      clientInformation: OAuthClientInformation,
    ): Promise<void> => {
      await setSecret(mcpOAuthClientKey(serverId), JSON.stringify(clientInformation))
    },

    authorizationServerInformation: async (): Promise<
      OAuthAuthorizationServerInformation | undefined
    > =>
      parseJson<OAuthAuthorizationServerInformation>(
        await getSecret(mcpOAuthAsInfoKey(serverId)),
      ),

    saveAuthorizationServerInformation: async (
      authorizationServerInformation: OAuthAuthorizationServerInformation,
    ): Promise<void> => {
      const existing = parseJson<{ origin?: string }>(
        await getSecret(mcpOAuthAsInfoKey(serverId)),
      )
      await setSecret(
        mcpOAuthAsInfoKey(serverId),
        JSON.stringify({
          ...authorizationServerInformation,
          origin:
            existing?.origin ??
            (authorizationServerInformation.authorizationServerUrl
              ? originOf(authorizationServerInformation.authorizationServerUrl)
              : undefined),
        }),
      )
    },

    validateAuthorizationServerURL: async (
      _serverUrl: string | URL,
      authorizationServerUrl: string | URL,
    ): Promise<void> => {
      const asOrigin = originOf(authorizationServerUrl)

      if (allowedAuthorizationServers && allowedAuthorizationServers.length > 0) {
        const allowed = allowedAuthorizationServers.some(
          (entry) => originOf(entry) === asOrigin,
        )
        if (!allowed) {
          throw new Error(
            `Authorization server origin ${asOrigin} is not in the allowlist`,
          )
        }
        return
      }

      const stored = parseJson<
        OAuthAuthorizationServerInformation & { origin?: string }
      >(await getSecret(mcpOAuthAsInfoKey(serverId)))

      const pinnedOrigin =
        stored?.origin ??
        (stored?.authorizationServerUrl
          ? originOf(stored.authorizationServerUrl)
          : undefined)

      if (pinnedOrigin) {
        if (pinnedOrigin !== asOrigin) {
          throw new Error(
            `Authorization server origin changed from ${pinnedOrigin} to ${asOrigin}`,
          )
        }
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

      await setSecret(
        mcpOAuthAsInfoKey(serverId),
        JSON.stringify({
          origin: asOrigin,
          authorizationServerUrl: String(authorizationServerUrl),
          tokenEndpoint: '',
        }),
      )
    },

    state: async (): Promise<string> => randomHex(32),

    saveState: async (state: string): Promise<void> => {
      await setSecret(mcpOAuthStateKey(serverId), state)
    },

    storedState: async (): Promise<string | undefined> => {
      const stored = await getSecret(mcpOAuthStateKey(serverId))
      return stored === null || stored.length === 0 ? undefined : stored
    },

    redirectToAuthorization: async (authorizationUrl: URL): Promise<void> => {
      await openUrl(authorizationUrl.toString(), authorizationUrl.origin)
    },

    invalidateCredentials: async (
      scope: 'all' | 'client' | 'tokens' | 'verifier',
    ): Promise<void> => {
      if (scope === 'all' || scope === 'tokens') {
        await deleteSecret(mcpOAuthTokensKey(serverId))
      }
      if (scope === 'all' || scope === 'client') {
        await deleteSecret(mcpOAuthClientKey(serverId))
        await deleteSecret(mcpOAuthAsInfoKey(serverId))
        await deleteSecret(mcpOAuthStateKey(serverId))
      }
      if (scope === 'all' || scope === 'verifier') {
        await deleteSecret(mcpOAuthVerifierKey(serverId))
      }
    },
  }

  return provider
}
