import type { OAuthTokens } from '@ai-sdk/mcp'
import type { McpHttpServer, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer } from '@/types/vixl/mcp-config'
import type { WwwAuthenticateChallenge } from '@/types/mcp/www-authenticate-challenge'
import {
  callHttpTool,
  getHttpLastRequestedScope,
  getHttpOauthChallenge,
  getHttpServerConfig,
} from '@/services/mcp/mcp-http-client'
import { mcpOAuthTokensKey } from '@/services/mcp/mcp-keychain-keys'
import {
  getLastOAuthChallenge,
  parseJson,
  unionScopes,
} from '@/services/mcp/oauth'
import { getSecret } from '@/services/vixl/vixl-tauri'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import type { McpRuntimeOptions } from './types'

const MAX_STEP_UP = 2
const stepUpAttempts = new Map<string, number>()

type AuthenticateFn = (
  serverId: string,
  config: McpServerConfig,
  options?: McpRuntimeOptions,
) => Promise<McpServerState>

const httpStatusOf = (error: unknown): number | undefined => {
  if (error && typeof error === 'object' && 'statusCode' in error) {
    const code = (error as { statusCode?: unknown }).statusCode
    return typeof code === 'number' ? code : undefined
  }
  return undefined
}

const isInsufficientScope = (
  error: unknown,
  challenge: WwwAuthenticateChallenge | undefined,
): boolean => {
  if (challenge?.error === 'insufficient_scope') {
    return true
  }
  if (httpStatusOf(error) === 403 && Boolean(challenge?.scope)) {
    return true
  }
  const message = error instanceof Error ? error.message : String(error)
  return /HTTP 403/i.test(message) && Boolean(challenge?.scope)
}

const grantedScope = async (serverId: string): Promise<string | undefined> => {
  const tokens = parseJson<OAuthTokens>(
    await getSecret(mcpOAuthTokensKey(serverId)),
  )
  return tokens?.scope
}

const challengeFor = (
  serverId: string,
  config: McpHttpServer | undefined,
): WwwAuthenticateChallenge | undefined =>
  getHttpOauthChallenge(serverId) ??
  (config ? getLastOAuthChallenge(config.url) : undefined)

const callHttpToolWithStepUp = async (
  serverId: string,
  tool: string,
  args: Record<string, unknown>,
  config: McpServerConfig | undefined,
  authenticate: AuthenticateFn,
): Promise<unknown> => {
  const httpConfig =
    (config && isMcpHttpServer(config) ? config : undefined) ??
    getHttpServerConfig(serverId)
  const key = `${serverId}:${tool}`

  try {
    const result = await callHttpTool(serverId, tool, args)
    stepUpAttempts.delete(key)
    return result
  } catch (error) {
    const challenge = challengeFor(serverId, httpConfig)
    if (!isInsufficientScope(error, challenge)) {
      throw error
    }
    const used = stepUpAttempts.get(key) ?? 0
    if (used >= MAX_STEP_UP) {
      stepUpAttempts.delete(key)
      throw error
    }
    if (!httpConfig) {
      throw error
    }
    stepUpAttempts.set(key, used + 1)
    const previous = unionScopes(
      getHttpLastRequestedScope(serverId),
      await grantedScope(serverId),
    )
    const scope = unionScopes(previous, challenge?.scope)
    await authenticate(serverId, httpConfig, {
      skipTrustCheck: true,
      scope,
      resourceMetadataUrl: challenge?.resourceMetadataUrl,
    })
    return callHttpToolWithStepUp(serverId, tool, args, httpConfig, authenticate)
  }
}

export default callHttpToolWithStepUp
