import type { OAuthClientProvider } from '@ai-sdk/mcp'
import type { StoredOAuthAsInfo } from '@/types/mcp/stored-oauth-as-info'
import type { OAuthCallbackPayload } from '@/services/mcp/mcp-runtime/types'
import assertAuthorizationResponse from './assert-authorization-response'
import readIssParameterSupported from './read-iss-parameter-supported'

const expectedIssuerOf = (
  stored: StoredOAuthAsInfo | undefined,
): string | undefined => stored?.issuer ?? stored?.authorizationServerUrl

const throwOAuthCallbackError = (payload: OAuthCallbackPayload): void => {
  const error = payload.error
  if (typeof error !== 'string' || error.length === 0) {
    return
  }
  const description = payload.errorDescription
  if (typeof description === 'string' && description.length > 0) {
    throw new Error(`${error}: ${description}`)
  }
  throw new Error(error)
}

const applyOAuthCallback = async (
  provider: OAuthClientProvider,
  payload: OAuthCallbackPayload,
): Promise<{
  authorizationCode: string
  callbackState: string
  callbackIssuer?: string
}> => {
  const stored = (await provider.authorizationServerInformation?.()) as
    | StoredOAuthAsInfo
    | undefined
  const expectedIssuer = expectedIssuerOf(stored)
  if (!expectedIssuer) {
    throw new Error('Stored OAuth authorization server issuer is required')
  }

  let advertised = stored?.authorization_response_iss_parameter_supported
  if (advertised === undefined && stored?.authorizationServerUrl) {
    advertised = await readIssParameterSupported(stored.authorizationServerUrl)
  }

  assertAuthorizationResponse({
    callbackIss: payload.iss,
    expectedIssuer,
    authorizationResponseIssParameterSupported: advertised,
  })

  throwOAuthCallbackError(payload)

  if (!payload.code) {
    throw new Error('OAuth callback missing code')
  }
  if (!payload.state) {
    throw new Error('OAuth callback missing state')
  }

  return {
    authorizationCode: payload.code,
    callbackState: payload.state,
    callbackIssuer: payload.iss || undefined,
  }
}

export default applyOAuthCallback
