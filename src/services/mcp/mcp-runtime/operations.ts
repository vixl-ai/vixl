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
import connectionKey from '@/services/mcp/connection-key'
import { assertServerTrusted } from './trust'
import { createTokenProvider, waitForOAuthCallback } from './oauth'
import { start, startHttp } from './lifecycle'
import type { McpRuntimeOptions } from './types'
import callHttpToolWithStepUp from './step-up'

const oauthInFlight = new Map<string, Promise<McpServerState>>()
const oauthAbortControllers = new Map<string, AbortController>()

const isOAuthCallbackAborted = (error: unknown): boolean =>
  error instanceof Error && error.message === 'OAuth callback aborted'

const runAuthenticateHttp = async (
  serverId: string,
  config: McpHttpServer,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  assertServerTrusted(serverId, config, options)

  const scopeKey = options?.scopeKey
  const flowId = connectionKey(scopeKey, serverId)
  const loopback = await oauthBeginLoopback(flowId)
  const abort = new AbortController()
  oauthAbortControllers.set(flowId, abort)
  const callbackPromise = waitForOAuthCallback(abort.signal, flowId)

  let result: McpServerState | undefined
  let failure: unknown

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
      getHttpOauthChallenge(serverId, scopeKey) ?? getLastOAuthChallenge(config.url)
    const scope = options?.scope ?? challenge?.scope
    const resourceMetadataUrl =
      options?.resourceMetadataUrl ?? challenge?.resourceMetadataUrl
    if (scope) {
      setHttpLastRequestedScope(serverId, scope, scopeKey)
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

    result = await startHttp(serverId, config, options, provider)
  } catch (error) {
    abort.abort()
    try {
      await callbackPromise
    } catch (callbackError) {
      if (!isOAuthCallbackAborted(callbackError)) {
        failure = callbackError
      }
    }
    if (failure === undefined) {
      markHttpAuthRequired(
        serverId,
        config,
        error instanceof Error ? error.message : 'Authentication failed',
        options?.scopeKey,
      )
      failure = error
    }
  } finally {
    oauthAbortControllers.delete(flowId)
    try {
      await oauthCancelLoopback(flowId)
    } catch (cancelError) {
      if (!(cancelError instanceof Error) && failure === undefined) {
        failure = cancelError
      }
    }
  }

  if (failure !== undefined) {
    throw failure
  }

  if (result === undefined) {
    throw new Error('OAuth authorization did not complete')
  }

  return result
}

export const cancelAuthenticate = (
  serverId: string,
  scopeKey?: string | null,
): boolean => {
  const controller = oauthAbortControllers.get(connectionKey(scopeKey, serverId))
  if (!controller) {
    return false
  }
  controller.abort()
  return true
}

export const authenticate = async (
  serverId: string,
  config: McpServerConfig,
  options?: McpRuntimeOptions,
): Promise<McpServerState> => {
  if (!isMcpHttpServer(config)) {
    return start(serverId, config, options)
  }

  const flowId = connectionKey(options?.scopeKey, serverId)
  const existing = oauthInFlight.get(flowId)
  if (existing) {
    return existing
  }

  const flight = runAuthenticateHttp(serverId, config, options).finally(() => {
    oauthInFlight.delete(flowId)
  })
  oauthInFlight.set(flowId, flight)
  return flight
}

export const callTool = async (
  serverId: string,
  tool: string,
  args: Record<string, unknown>,
  config?: McpServerConfig,
  scopeKey?: string | null,
): Promise<unknown> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId, scopeKey)) {
    return callHttpToolWithStepUp(
      serverId,
      tool,
      args,
      config,
      authenticate,
      scopeKey,
    )
  }
  return mcpCallTool(serverId, tool, args, scopeKey ?? undefined)
}

const statusConnectionKey = (
  key: string,
  state: McpServerState,
): string => {
  const scoped = state as McpServerState & { scopeKey?: string }
  if (scoped.scopeKey) {
    return connectionKey(scoped.scopeKey, state.serverId)
  }
  if (key.includes('\u001f')) {
    return key
  }
  return connectionKey(undefined, state.serverId)
}

export const listStatuses = async (
  scopeKey?: string | null,
): Promise<Record<string, McpServerState>> => {
  const stdio = await mcpListStatuses(scopeKey ?? undefined)
  const merged: Record<string, McpServerState> = {}
  for (const [key, state] of Object.entries(stdio)) {
    merged[statusConnectionKey(key, state)] = state
  }
  for (const [key, state] of Object.entries(listHttpStates())) {
    merged[statusConnectionKey(key, state)] = state
  }
  return merged
}

export const getStatus = async (
  serverId: string,
  config?: McpServerConfig,
  scopeKey?: string | null,
): Promise<McpServerState> => {
  if (config ? isMcpHttpServer(config) : hasHttpServer(serverId, scopeKey)) {
    const httpState = getHttpState(serverId, scopeKey)
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
  return mcpStatus(serverId, scopeKey ?? undefined)
}

export const listResources = async (
  serverId: string,
  scopeKey?: string | null,
): Promise<unknown> => {
  if (!hasHttpServer(serverId, scopeKey)) {
    throw new Error('MCP resources require a connected HTTP or SSE server')
  }
  return listHttpResources(serverId, scopeKey)
}

export const readResource = async (
  serverId: string,
  uri: string,
  scopeKey?: string | null,
): Promise<unknown> => {
  if (!hasHttpServer(serverId, scopeKey)) {
    throw new Error('MCP resources require a connected HTTP or SSE server')
  }
  return readHttpResource(serverId, uri, scopeKey)
}

export const listPrompts = async (
  serverId: string,
  scopeKey?: string | null,
): Promise<unknown> => {
  if (!hasHttpServer(serverId, scopeKey)) {
    throw new Error('MCP prompts require a connected HTTP or SSE server')
  }
  return listHttpPrompts(serverId, scopeKey)
}

export const getPrompt = async (
  serverId: string,
  name: string,
  promptArgs?: Record<string, unknown>,
  scopeKey?: string | null,
): Promise<unknown> => {
  if (!hasHttpServer(serverId, scopeKey)) {
    throw new Error('MCP prompts require a connected HTTP or SSE server')
  }
  return getHttpPrompt(serverId, name, promptArgs, scopeKey)
}
