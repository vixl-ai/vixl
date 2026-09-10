import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const { readMcpConfig, mcpGetStatus } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, projectRoot: string | null) => Promise<unknown>>(),
  mcpGetStatus: vi.fn<(serverId: string) => Promise<unknown>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
  }),
)

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    callTool: vi.fn<() => Promise<unknown>>(),
    getStatus: (serverId: string) => mcpGetStatus(serverId),
    start: vi.fn<() => Promise<void>>(),
    stop: vi.fn<() => Promise<void>>(),
  },
}))

vi.mock('@/services/mcp/mcp-trust', () => ({
  isMcpTrusted: vi.fn<() => boolean>(() => true),
  sessionTrusts: new Map(),
  getMcpTrust: vi.fn<() => unknown>(),
  upsertMcpTrustRecord: vi.fn<() => void>(),
  clearSessionTrust: vi.fn<() => void>(),
}))

import { isMcpTrusted } from '@/services/mcp/mcp-trust'
import getMcpTools from '@/services/harness/mcp/get-tools'

const LONG_DESCRIPTION = `${'B'.repeat(250)} extra detail`

const inputSchema = {
  type: 'object',
  properties: {
    query: { type: 'string' },
  },
}

const docsTool = {
  name: 'search_docs',
  description: LONG_DESCRIPTION,
  inputSchema,
  meta: {
    inputExamples: [{ query: 'vite' }],
  },
}

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

const runTool = async (input: Record<string, unknown> = {}): Promise<unknown> => {
  const built = getMcpTools(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'tc-get-mcp-tools' })
}

describe('get_mcp_tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isMcpTrusted).mockReturnValue(true)
    readMcpConfig.mockImplementation(async (scope: string) => {
      if (scope === 'personal') {
        return {
          servers: {
            docs: { command: 'npx', args: ['-y', 'docs-mcp'] },
            broken: { command: 'npx', args: ['-y', 'broken-mcp'] },
          },
        }
      }
      return null
    })
    mcpGetStatus.mockImplementation(async (serverId: string) => {
      if (serverId === 'broken') {
        throw new Error('status failed')
      }
      return {
        serverId,
        status: 'connected',
        tools: [docsTool],
        error: null,
      }
    })
  })

  it('lists servers without inputSchema or inputExamples on tools when serverId is omitted', async () => {
    const result = await runTool({})

    expect(result).toEqual({
      servers: [
        {
          serverId: 'broken',
          scope: 'personal',
          status: 'error',
          trusted: true,
          authRequired: false,
          error: 'status failed',
          tools: [],
        },
        {
          serverId: 'docs',
          scope: 'personal',
          status: 'connected',
          trusted: true,
          authRequired: false,
          error: null,
          tools: [
            {
              name: 'search_docs',
              description: `${LONG_DESCRIPTION.slice(0, 200)}...`,
            },
          ],
        },
      ],
    })

    const listed = result as {
      servers: Array<{ tools: Array<Record<string, unknown>> }>
    }
    for (const tool of listed.servers.flatMap((entry) => entry.tools)) {
      expect(tool).not.toHaveProperty('inputSchema')
      expect(tool).not.toHaveProperty('inputExamples')
      expect(Object.keys(tool).sort()).toEqual(['description', 'name'])
    }
  })

  it('returns a single unwrapped entry with full schemas when serverId is set', async () => {
    const result = await runTool({ serverId: 'docs' })

    expect(result).toEqual({
      serverId: 'docs',
      scope: 'personal',
      status: 'connected',
      trusted: true,
      authRequired: false,
      error: null,
      tools: [
        {
          name: 'search_docs',
          description: `${LONG_DESCRIPTION.slice(0, 200)}...`,
          inputSchema,
          inputExamples: [{ query: 'vite' }],
        },
      ],
    })
    expect(result).not.toHaveProperty('servers')
  })

  it('returns an error when serverId is unknown', async () => {
    const result = await runTool({ serverId: 'missing' })

    expect(result).toEqual({
      error: 'MCP server "missing" was not found in any mcp.json config.',
    })
    expect(mcpGetStatus).not.toHaveBeenCalled()
  })

  it('returns an error catalog entry when getStatus throws for a server', async () => {
    const result = await runTool({ serverId: 'broken' })

    expect(result).toEqual({
      serverId: 'broken',
      scope: 'personal',
      status: 'error',
      trusted: true,
      authRequired: false,
      error: 'status failed',
      tools: [],
    })
  })
})
