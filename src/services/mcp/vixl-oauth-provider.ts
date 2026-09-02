import type {
  OAuthAuthorizationServerInformation,
  OAuthClientInformation,
  OAuthClientProvider,
  OAuthTokens,
} from '@ai-sdk/mcp'
import type { StoredOAuthAsInfo } from '@/types/mcp/stored-oauth-as-info'
import type { StoredOAuthDcrClient } from '@/types/mcp/stored-oauth-dcr-client'
import {
  mcpOAuthAsInfoKey,
  mcpOAuthClientKey,
  mcpOAuthStateKey,
  mcpOAuthTokensKey,
  mcpOAuthVerifierKey,
} from '@/services/mcp/mcp-keychain-keys'
import {
  nativeClientMetadata,
  clientAllowsRedirect,
  createValidateAuthorizationServerUrl,
  originOf,
  parseJson,
  readIssParameterSupported,
  validateResourceUrl,
  loadStaticOAuthClient,
} from '@/services/mcp/oauth'
import { deleteSecret, getSecret, setSecret } from '@/services/vixl/vixl-tauri'

type CreateVixlOAuthProviderArgs = {
  serverId: string
  serverUrl: string
  clientId?: string
  allowedAuthorizationServers?: string[]
  redirectUrl: string
  openUrl: (url: string, allowedOrigin: string) => void | Promise<void>
  confirmAuthorizationServerOrigin?: (origin: string) => Promise<boolean>
  allowDynamicRegistration?: boolean
}

const randomHex = (bytes: number): string => {
  const buffer = new Uint8Array(bytes)
  crypto.getRandomValues(buffer)
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

const withIssuer = <T extends { issuer?: string }>(
  value: T,
  issuer: string | undefined,
): T => (issuer && !value.issuer ? { ...value, issuer } : value)

export const createVixlOAuthProvider = (
  args: CreateVixlOAuthProviderArgs,
): OAuthClientProvider => {
  const {
    serverId,
    serverUrl,
    clientId,
    allowedAuthorizationServers,
    redirectUrl,
    openUrl,
    confirmAuthorizationServerOrigin,
    allowDynamicRegistration = true,
  } = args

  const storedIssuer = async (): Promise<string | undefined> => {
    const stored = parseJson<StoredOAuthAsInfo>(
      await getSecret(mcpOAuthAsInfoKey(serverId)),
    )
    return stored?.issuer
  }

  const invalidateClientAndTokens = async (): Promise<void> => {
    await deleteSecret(mcpOAuthTokensKey(serverId))
    await deleteSecret(mcpOAuthClientKey(serverId))
    await deleteSecret(mcpOAuthAsInfoKey(serverId))
    await deleteSecret(mcpOAuthStateKey(serverId))
  }

  const provider: OAuthClientProvider = {
    get redirectUrl() {
      return redirectUrl
    },

    get clientMetadata() {
      return nativeClientMetadata(redirectUrl)
    },

    tokens: async (): Promise<OAuthTokens | undefined> =>
      parseJson<OAuthTokens>(await getSecret(mcpOAuthTokensKey(serverId))),

    saveTokens: async (tokens: OAuthTokens): Promise<void> => {
      await setSecret(
        mcpOAuthTokensKey(serverId),
        JSON.stringify(withIssuer(tokens, await storedIssuer())),
      )
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
      const stored = parseJson<StoredOAuthDcrClient>(
        await getSecret(mcpOAuthClientKey(serverId)),
      )
      if (stored) {
        if (
          allowDynamicRegistration &&
          !clientAllowsRedirect(stored, redirectUrl)
        ) {
          await deleteSecret(mcpOAuthTokensKey(serverId))
          await deleteSecret(mcpOAuthClientKey(serverId))
          await deleteSecret(mcpOAuthStateKey(serverId))
        } else {
          return stored
        }
      }
      const staticClient = await loadStaticOAuthClient(serverId)
      if (clientId) {
        return {
          client_id: clientId,
          ...(staticClient?.client_secret
            ? { client_secret: staticClient.client_secret }
            : {}),
        }
      }
      if (staticClient) {
        return {
          client_id: staticClient.client_id,
          ...(staticClient.client_secret
            ? { client_secret: staticClient.client_secret }
            : {}),
        }
      }
      return undefined
    },

    ...(allowDynamicRegistration
      ? {
          saveClientInformation: async (
            clientInformation: OAuthClientInformation,
          ): Promise<void> => {
            const incoming = clientInformation as StoredOAuthDcrClient
            const existingUris = Array.isArray(incoming.redirect_uris)
              ? incoming.redirect_uris.filter(
                  (uri): uri is string => typeof uri === 'string',
                )
              : []
            const redirectUris = existingUris.includes(redirectUrl)
              ? existingUris
              : [...existingUris, redirectUrl]
            const stored: StoredOAuthDcrClient = {
              ...withIssuer(clientInformation, await storedIssuer()),
              redirect_uris: redirectUris,
            }
            await setSecret(mcpOAuthClientKey(serverId), JSON.stringify(stored))
          },
        }
      : {}),

    authorizationServerInformation: async (): Promise<
      StoredOAuthAsInfo | undefined
    > => parseJson<StoredOAuthAsInfo>(await getSecret(mcpOAuthAsInfoKey(serverId))),

    saveAuthorizationServerInformation: async (
      authorizationServerInformation: OAuthAuthorizationServerInformation,
    ): Promise<void> => {
      const existing = parseJson<StoredOAuthAsInfo>(
        await getSecret(mcpOAuthAsInfoKey(serverId)),
      )
      const issSupported = await readIssParameterSupported(
        authorizationServerInformation.authorizationServerUrl,
      )
      await setSecret(
        mcpOAuthAsInfoKey(serverId),
        JSON.stringify({
          ...existing,
          ...authorizationServerInformation,
          origin:
            existing?.origin ??
            originOf(authorizationServerInformation.authorizationServerUrl),
          issuer:
            authorizationServerInformation.issuer ??
            existing?.issuer ??
            authorizationServerInformation.authorizationServerUrl,
          authorization_response_iss_parameter_supported:
            issSupported ??
            existing?.authorization_response_iss_parameter_supported,
        }),
      )
    },

    validateAuthorizationServerURL: createValidateAuthorizationServerUrl({
      serverId,
      clientId,
      allowedAuthorizationServers,
      confirmAuthorizationServerOrigin,
      invalidateClientAndTokens,
    }),

    validateResourceURL: async (requested, resource) =>
      validateResourceUrl(requested || serverUrl, resource),

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
