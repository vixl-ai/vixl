import { listen } from '@tauri-apps/api/event'
import type { OAuthClientProvider } from '@ai-sdk/mcp'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import { createVixlOAuthProvider } from '@/services/mcp/vixl-oauth-provider'
import {
  OAUTH_CALLBACK_TIMEOUT_MS,
  type OAuthCallbackPayload,
} from './types'

export const createTokenProvider = (
  serverId: string,
  config: McpHttpServer,
  redirectUrl: string,
  openUrl: (url: string, allowedOrigin: string) => Promise<void>,
  confirmAuthorizationServerOrigin?: (origin: string) => Promise<boolean>,
): OAuthClientProvider =>
  createVixlOAuthProvider({
    serverId,
    serverUrl: config.url,
    clientId: config.oauth?.clientId,
    allowedAuthorizationServers: config.oauth?.allowedAuthorizationServers,
    redirectUrl,
    openUrl,
    confirmAuthorizationServerOrigin,
  })

export const waitForOAuthCallback = async (
  signal: AbortSignal,
  flowId: string,
): Promise<OAuthCallbackPayload> => {
  let unlisten: (() => void) | undefined
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let settled = false
  let onAbort: (() => void) | undefined

  const cleanup = (): void => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId)
      timeoutId = undefined
    }
    if (onAbort) {
      signal.removeEventListener('abort', onAbort)
      onAbort = undefined
    }
    if (unlisten) {
      unlisten()
      unlisten = undefined
    }
  }

  try {
    return await new Promise<OAuthCallbackPayload>((resolve, reject) => {
      const settle = (
        action: 'resolve' | 'reject',
        value: OAuthCallbackPayload | Error,
      ): void => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (action === 'resolve') {
          resolve(value as OAuthCallbackPayload)
          return
        }
        reject(value)
      }

      if (signal.aborted) {
        settle('reject', new Error('OAuth callback aborted'))
        return
      }

      onAbort = (): void => {
        settle('reject', new Error('OAuth callback aborted'))
      }
      signal.addEventListener('abort', onAbort)

      timeoutId = setTimeout(() => {
        settle('reject', new Error('OAuth callback timed out'))
      }, OAUTH_CALLBACK_TIMEOUT_MS)

      listen<OAuthCallbackPayload>('oauth-callback', (event) => {
        if (event.payload.flowId && event.payload.flowId !== flowId) {
          return
        }
        const hasState =
          typeof event.payload.state === 'string' &&
          event.payload.state.length > 0
        const hasError =
          typeof event.payload.error === 'string' &&
          event.payload.error.length > 0
        const hasIss =
          typeof event.payload.iss === 'string' && event.payload.iss.length > 0
        if (!hasState && !hasError && !hasIss) {
          settle('reject', new Error('OAuth callback missing state'))
          return
        }
        settle('resolve', event.payload)
      })
        .then((fn) => {
          if (settled) {
            fn()
            return
          }
          unlisten = fn
          if (signal.aborted) {
            settle('reject', new Error('OAuth callback aborted'))
          }
        })
        .catch((error: unknown) => {
          settle(
            'reject',
            error instanceof Error ? error : new Error(String(error)),
          )
        })
    })
  } finally {
    cleanup()
  }
}
