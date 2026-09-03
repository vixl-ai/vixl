import { auth } from '@ai-sdk/mcp'
import type { McpHttpServer, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer } from '@/types/vixl/mcp-config'
import {
  getHttpPrompt,
  getHttpState,
  hasHttpServer,
  listHttpPrompts,
  listHttpResources,
  listHttpStates,
  markHttpAuthRequired,
  readHttpResource,
  getHttpOauthChallenge,
  setHttpLastRequestedScope,
} from '@/services/mcp/mcp-http-client'
import { mcpOAuthFetch } from '@/services/mcp/mcp-oauth-fetch'
import {
  mcpCallTool,
  mcpListStatuses,
  mcpStatus,
  oauthBeginLoopback,
  oauthCancelLoopback,
  openExternalUrl,
  type McpServerState,
} from '@/services/vixl/vixl-tauri'
import { applyOAuthCallback, getLastOAuthChallenge } from '@/services/mcp/oauth'
import { assertServerTrusted } from './trust'
import { createTokenProvider, waitForOAuthCallback } from './oauth'
import { start, startHttp } from './lifecycle'
import type { McpRuntimeOptions } from './types'
import callHttpToolWithStepUp from './step-up'

const oauthInFlight = new Map<string, Promise<McpServerState>>()

const isOAuthCallbackAborted = (error: unknown): boolean =>
  error instanceof Error && error.message === 'OAuth callback aborted'

const runAuthenticateHttp = async (
  serverId: string,
  config: McpHttpServer,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  assertServerTrusted(serverId, config, options)

  const loopback = await oauthBeginLoopback(serverId)
  const abort = new AbortController()
  const callbackPromise = waitForOAuthCallback(abort.signal, serverId)

  try {
    const provider = createTokenProvider(
      serverId,
      config,
      loopback.redirectUrl,
      async (url: string, allowedOrigin: string) => {
        await openExternalUrl(url, allowedOrigin)
      },
      options?.confirmAuthorizationServerOrigin,
    )

    const challenge =
      getHttpOauthChallenge(serverId) ?? getLastOAuthChallenge(config.url)
    const scope = options?.scope ?? challenge?.scope
    const resourceMetadataUrl =
      options?.resourceMetadataUrl ?? challenge?.resourceMetadataUrl
    if (scope) {
      setHttpLastRequestedScope(serverId, scope)
    }

    const authBase = {
      serverUrl: config.url,
      fetchFn: mcpOAuthFetch,
      scope,
      resourceMetadataUrl,
    }

    const first = await auth(provider, authBase)
    if (first === 'REDIRECT') {
      const callback = await callbackPromise
      const exchange = await applyOAuthCallback(provider, callback)
      const second = await auth(provider, {
        ...authBase,
        authorizationCode: exchange.authorizationCode,
        callbackState: exchange.callbackState,
        callbackIssuer: exchange.callbackIssuer,
      })
      if (second !== 'AUTHORIZED') {
        throw new Error('OAuth authorization did not complete')
      }
    } else if (first !== 'AUTHORIZED') {
      throw new Error('OAuth authorization did not complete')
    } else {
      abort.abort()
      try {
        await callbackPromise
      } catch (callbackError) {
        if (!isOAuthCallbackAborted(callbackError)) {
          throw callbackError
        }
      }
    }

    return startHttp(serverId, config, options, provider)
  } catch (error) {
    abort.abort()
    try {
      await callbackPromise
    } catch (callbackError) {
      if (!isOAuthCallbackAborted(callbackError)) {
        throw callbackError
      }
    }
    markHttpAuthRequired(
      serverId,
      config,
      error instanceof Error ? error.message : 'Authentication failed',
    )
    throw error
  } finally {
    try {
      await oauthCancelLoopback(serverId)
    } catch (cancelError) {
      if (!(cancelError instanceof Error)) {
        throw cancelError
      }
    }
  }
}

export const authenticate = async (
  serverId: string,
  config: McpServerConfig,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  if (!isMcpHttpServer(config)) {
    return start(serverId, config, options)
  }

  const existing = oauthInFlight.get(serverId)
  if (existing) {
    return existing
  }

  const flight = runAuthenticateHttp(serverId, config, options).finally(() => {
    oauthInFlight.delete(serverId)
  })
  oauthInFlight.set(serverId, flight)
  return flight
}

export const callTool = async (
  serverId: string,
  tool: string,
  args: Record<string, unknown>,
  config?: McpServerConfig,
): Promise<unknown> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId)) {
    return callHttpToolWithStepUp(serverId, tool, args, config, authenticate)
  }
  return mcpCallTool(serverId, tool, args)
}

export const listStatuses = async (): Promise<Record<string, McpServerState>> => {
  const stdio = await mcpListStatuses()
  return {
    ...stdio,
    ...listHttpStates(),
  }
}

export const getStatus = async (
  serverId: string,
  config?: McpServerConfig,
): Promise<McpServerState> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId)) {
    const httpState = getHttpState(serverId)
    if (httpState) {
      return httpState
    }
    return {
      serverId,
      status: 'stopped',
      tools: [],
      error: null,
    }
  }
  return mcpStatus(serverId)
}

export const listResources = async (serverId: string): Promise<unknown> => {
  if (!hasHttpServer(serverId)) {
    throw new Error('MCP resources require a connected HTTP or SSE server')
  }
  return listHttpResources(serverId)
}

export const readResource = async (serverId: string, uri: string): Promise<unknown> => {
  if (!hasHttpServer(serverId)) {
    throw new Error('MCP resources require a connected HTTP or SSE server')
  }
  return readHttpResource(serverId, uri)
}

export const listPrompts = async (serverId: string): Promise<unknown> => {
  if (!hasHttpServer(serverId)) {
    throw new Error('MCP prompts require a connected HTTP or SSE server')
  }
  return listHttpPrompts(serverId)
}

export const getPrompt = async (
  serverId: string,
  name: string,
  promptArgs?: Record<string, unknown>,
): Promise<unknown> => {
  if (!hasHttpServer(serverId)) {
    throw new Error('MCP prompts require a connected HTTP or SSE server')
  }
  return getHttpPrompt(serverId, name, promptArgs)
}
