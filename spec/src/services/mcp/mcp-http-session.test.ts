import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPClient, OAuthClientProvider } from '@ai-sdk/mcp'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const createMCPClientMock = vi.hoisted(() =>
  vi.fn<(config: unknown) => Promise<MCPClient>>(),
)

const proxyFetchImpl = vi.hoisted(() =>
  vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/providers/proxy-fetch', () => ({
  default: () => proxyFetchImpl,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(message: string, options?: { description?: string }) => void>(),
    success: vi.fn<(message: string) => void>(),
  },
}))

vi.mock('@/services/mcp/mcp-tool-baseline', () => ({
  loadMcpToolBaseline: vi.fn<(serverId: string) => Promise<null>>(async () => null),
  saveMcpToolBaseline: vi.fn<
    (serverId: string, tools: unknown) => Promise<Record<string, never>>
  >(async () => ({})),
  detectMcpToolDrift: vi.fn<
    (
      serverId: string,
      tools: unknown,
    ) => Promise<{
      drifted: boolean
      changed: string[]
      added: string[]
      removed: string[]
    }>
  >(async () => ({
    drifted: false,
    changed: [],
    added: [],
    removed: [],
  })),
}))

vi.mock('@ai-sdk/mcp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ai-sdk/mcp')>()
  return {
    ...actual,
    createMCPClient: createMCPClientMock,
  }
})

import { startHttpServer, stopHttpServer } from '@/services/mcp/mcp-http-client'
import { httpServers } from '@/services/mcp/mcp-http-client/store'

type TransportConfig = {
  type?: string
  initialSessionId?: string
  terminateSessionOnClose?: boolean
  onSessionIdChange?: (sessionId: string | undefined) => void
  onSessionExpired?: (sessionId: string) => void
  authProvider?: OAuthClientProvider
}

type CreateClientConfig = {
  transport: TransportConfig
  initialInitializeResult?: unknown
}

const transportOf = (callIndex: number): TransportConfig => {
  const config = createMCPClientMock.mock.calls[callIndex]?.[0] as
    | CreateClientConfig
    | undefined
  if (!config?.transport) {
    throw new Error(`createMCPClient was not called at index ${callIndex}`)
  }
  return config.transport
}

const configOf = (callIndex: number): CreateClientConfig => {
  const config = createMCPClientMock.mock.calls[callIndex]?.[0] as
    | CreateClientConfig
    | undefined
  if (!config) {
    throw new Error(`createMCPClient was not called at index ${callIndex}`)
  }
  return config
}

const mockClient = (): MCPClient =>
  ({
    onElicitationRequest: vi.fn<() => void>(),
    listTools: vi.fn<
      () => Promise<{ tools: { name: string; description: string }[] }>
    >(async () => ({
      tools: [{ name: 'ping', description: 'Ping' }],
    })),
    close: vi.fn<() => Promise<void>>(async () => {}),
    serverInfo: {},
    callTool: vi.fn<() => Promise<unknown>>(),
  }) as unknown as MCPClient

describe('mcp http session interop', () => {
  beforeEach(() => {
    httpServers.clear()
    createMCPClientMock.mockReset()
    createMCPClientMock.mockImplementation(async () => mockClient())
  })

  it('wires http session callbacks and reconnects without the expired session id', async () => {
    const authProvider = {} as OAuthClientProvider
    await startHttpServer(
      'legacy-http',
      { type: 'http', url: 'https://mcp.example/mcp' },
      { authProvider },
    )

    expect(createMCPClientMock).toHaveBeenCalledTimes(1)
    const first = transportOf(0)
    expect(first.type).toBe('http')
    expect(first.terminateSessionOnClose).toBe(true)
    expect(first.initialSessionId).toBeUndefined()
    expect(configOf(0).initialInitializeResult).toBeUndefined()
    expect(first.authProvider).toBe(authProvider)
    expect(typeof first.onSessionIdChange).toBe('function')
    expect(typeof first.onSessionExpired).toBe('function')

    first.onSessionIdChange?.('sess-legacy-1')
    expect(httpServers.get('legacy-http')?.sessionId).toBe('sess-legacy-1')

    first.onSessionIdChange?.(undefined)
    first.onSessionExpired?.('sess-legacy-1')
    await vi.waitFor(() => {
      expect(createMCPClientMock).toHaveBeenCalledTimes(2)
    })

    const second = transportOf(1)
    expect(second.type).toBe('http')
    expect(second.terminateSessionOnClose).toBe(true)
    expect(second.initialSessionId).toBeUndefined()
    expect(configOf(1).initialInitializeResult).toBeUndefined()
    expect(second.authProvider).toBe(authProvider)
    expect(httpServers.get('legacy-http')?.sessionId).toBeNull()
    expect(httpServers.get('legacy-http')?.state.status).toBe('connected')
  })

  it('does not pass session options for sse transports', async () => {
    await startHttpServer('sse-server', {
      type: 'sse',
      url: 'https://mcp.example/sse',
    })

    expect(createMCPClientMock).toHaveBeenCalledTimes(1)
    const transport = transportOf(0)
    expect(transport.type).toBe('sse')
    expect(transport.terminateSessionOnClose).toBeUndefined()
    expect(transport.onSessionIdChange).toBeUndefined()
    expect(transport.onSessionExpired).toBeUndefined()
    expect(transport.initialSessionId).toBeUndefined()
  })

  it('clears the in-memory session id on stop', async () => {
    await startHttpServer('stop-http', {
      type: 'http',
      url: 'https://mcp.example/mcp',
    })
    transportOf(0).onSessionIdChange?.('sess-to-clear')
    expect(httpServers.get('stop-http')?.sessionId).toBe('sess-to-clear')

    await stopHttpServer('stop-http')
    expect(httpServers.get('stop-http')?.sessionId).toBeNull()
    expect(httpServers.get('stop-http')?.state.status).toBe('stopped')
  })
})
