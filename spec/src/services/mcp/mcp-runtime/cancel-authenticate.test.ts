import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpHttpServer } from '@/types/vixl/mcp-config'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const { auth, oauthBeginLoopback, oauthCancelLoopback, waitForOAuthCallback } =
  vi.hoisted(() => ({
    auth: vi.fn<(...args: unknown[]) => Promise<string>>(),
    oauthBeginLoopback: vi.fn<(flowId: string) => Promise<{ port: number; redirectUrl: string }>>(
      async () => ({
        port: 43721,
        redirectUrl: 'http://127.0.0.1:43721/callback',
      }),
    ),
    oauthCancelLoopback: vi.fn<(flowId: string) => Promise<void>>(async () => undefined),
    waitForOAuthCallback: vi.fn<(signal: AbortSignal, flowId: string) => Promise<never>>(
      (signal) =>
        new Promise((_, reject) => {
          const onAbort = (): void => {
            reject(new Error('OAuth callback aborted'))
          }
          if (signal.aborted) {
            onAbort()
            return
          }
          signal.addEventListener('abort', onAbort, { once: true })
        }),
    ),
  }))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    oauthBeginLoopback,
    oauthCancelLoopback,
  }),
)

vi.mock('@ai-sdk/mcp', () => ({
  auth: (...args: unknown[]) => auth(...args),
}))

vi.mock('@/services/mcp/mcp-runtime/oauth', () => ({
  createTokenProvider: vi.fn<(...args: unknown[]) => Record<string, never>>(() => ({})),
  waitForOAuthCallback: (signal: AbortSignal, flowId: string) =>
    waitForOAuthCallback(signal, flowId),
}))

vi.mock('@/services/mcp/mcp-http-client', () => ({
  getHttpPrompt: vi.fn<(...args: unknown[]) => unknown>(),
  getHttpState: vi.fn<(...args: unknown[]) => unknown>(),
  hasHttpServer: vi.fn<(...args: unknown[]) => boolean>(() => false),
  listHttpPrompts: vi.fn<(...args: unknown[]) => unknown>(),
  listHttpResources: vi.fn<(...args: unknown[]) => unknown>(),
  listHttpStates: vi.fn<(...args: unknown[]) => Record<string, never>>(() => ({})),
  markHttpAuthRequired: vi.fn<(...args: unknown[]) => void>(),
  readHttpResource: vi.fn<(...args: unknown[]) => unknown>(),
  getHttpOauthChallenge: vi.fn<(...args: unknown[]) => undefined>(() => undefined),
  setHttpLastRequestedScope: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('@/services/mcp/mcp-oauth-fetch', () => ({
  mcpOAuthFetch: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('@/services/mcp/oauth', () => ({
  applyOAuthCallback: vi.fn<(...args: unknown[]) => unknown>(),
  getLastOAuthChallenge: vi.fn<(...args: unknown[]) => undefined>(() => undefined),
}))

vi.mock('@/services/mcp/mcp-runtime/lifecycle', () => ({
  start: vi.fn<(...args: unknown[]) => unknown>(),
  startHttp: vi.fn<(...args: unknown[]) => unknown>(),
  stop: vi.fn<(...args: unknown[]) => unknown>(),
  refresh: vi.fn<(...args: unknown[]) => unknown>(),
  logout: vi.fn<(...args: unknown[]) => unknown>(),
}))

vi.mock('@/services/mcp/mcp-runtime/step-up', () => ({
  default: vi.fn<(...args: unknown[]) => unknown>(),
}))

import {
  authenticate,
  cancelAuthenticate,
} from '@/services/mcp/mcp-runtime/operations'

const httpConfig: McpHttpServer = {
  type: 'http',
  url: 'https://example.com/mcp',
}

describe('cancelAuthenticate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue('REDIRECT')
  })

  it('is a no-op when no OAuth flow is in flight', () => {
    expect(cancelAuthenticate('missing-server')).toBe(false)
  })

  it('aborts an in-flight HTTP OAuth flow', async () => {
    const pending = authenticate('github', httpConfig, { skipTrustCheck: true })
    await vi.waitFor(() => {
      expect(auth).toHaveBeenCalled()
    })

    expect(cancelAuthenticate('github')).toBe(true)
    await expect(pending).rejects.toThrow('OAuth callback aborted')
    expect(oauthCancelLoopback).toHaveBeenCalledWith('github')
    expect(cancelAuthenticate('github')).toBe(false)
  })
})
