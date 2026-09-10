import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const { readMcpConfig, mcpGetStatus } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, projectRoot: string | null) => Promise<unknown>>(),
  mcpGetStatus: vi.fn<(serverId: string, config?: unknown, scopeKey?: string) => Promise<unknown>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
  }),
)

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    callTool: vi.fn<() => Promise<unknown>>(),
    getStatus: (serverId: string, config?: unknown, scopeKey?: string) =>
      mcpGetStatus(serverId, config, scopeKey),
    start: vi.fn<() => Promise<void>>(),
    stop: vi.fn<() => Promise<void>>(),
  },
}))

import getMcpTool from '@/services/harness/mcp/get-tool'

const LONG_DESCRIPTION = `${'A'.repeat(250)} extra detail`

const inputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
}

const connectedStatus = (overrides: Record<string, unknown> = {}) => ({
  serverId: 'brave',
  status: 'connected',
  tools: [
    {
      name: 'brave_web_search',
      description: LONG_DESCRIPTION,
      inputSchema,
      meta: {
        inputExamples: [{ query: 'example search' }],
      },
    },
  ],
  error: null,
  ...overrides,
})

const ctx: HarnessToolContext = {
  projectRoot: '/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  userMessageId: 'user-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
}

const runTool = async (input: Record<string, unknown>): Promise<unknown> => {
  const built = getMcpTool(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'tc-get-mcp-tool' })
}

describe('get_mcp_tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readMcpConfig.mockImplementation(async (scope: string) => {
      if (scope === 'personal') {
        return {
          servers: {
            brave: { command: 'npx', args: ['-y', '@brave/brave-search-mcp-server'] },
          },
        }
      }
      return null
    })
    mcpGetStatus.mockResolvedValue(connectedStatus())
  })

  it('returns the full untruncated description, schema, and examples on a hit', async () => {
    const result = await runTool({
      serverId: 'brave',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      serverId: 'brave',
      name: 'brave_web_search',
      description: LONG_DESCRIPTION,
      inputSchema,
      inputExamples: [{ query: 'example search' }],
    })
    expect((result as { description: string }).description.length).toBeGreaterThan(200)
    expect(mcpGetStatus).toHaveBeenCalledWith('brave', undefined, 'personal')
  })

  it('returns inputExamples null when meta does not include them', async () => {
    mcpGetStatus.mockResolvedValue(
      connectedStatus({
        tools: [
          {
            name: 'brave_web_search',
            description: 'Search the web',
            inputSchema,
          },
        ],
      }),
    )

    const result = await runTool({
      serverId: 'brave',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      serverId: 'brave',
      name: 'brave_web_search',
      description: 'Search the web',
      inputSchema,
      inputExamples: null,
    })
  })

  it('returns an error when the server id is unknown', async () => {
    const result = await runTool({
      serverId: 'missing',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      error: 'MCP server "missing" was not found in any mcp.json config.',
    })
    expect(mcpGetStatus).not.toHaveBeenCalled()
  })

  it('returns an error when getStatus throws', async () => {
    mcpGetStatus.mockRejectedValue(new Error('runtime down'))

    const result = await runTool({
      serverId: 'brave',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      error: 'runtime down',
    })
  })

  it('returns an error when the server status is error', async () => {
    mcpGetStatus.mockResolvedValue({
      serverId: 'brave',
      status: 'error',
      tools: [],
      error: 'spawn failed',
    })

    const result = await runTool({
      serverId: 'brave',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      error: 'spawn failed',
    })
  })

  it('returns an error when the server status is stopped', async () => {
    mcpGetStatus.mockResolvedValue({
      serverId: 'brave',
      status: 'stopped',
      tools: [],
      error: null,
    })

    const result = await runTool({
      serverId: 'brave',
      tool: 'brave_web_search',
    })

    expect(result).toEqual({
      error: 'MCP server "brave" is not reachable (stopped).',
    })
  })

  it('returns an error when the tool name is not on the server', async () => {
    const result = await runTool({
      serverId: 'brave',
      tool: 'does_not_exist',
    })

    expect(result).toEqual({
      error: 'MCP tool "does_not_exist" was not found on server "brave".',
    })
  })
})
