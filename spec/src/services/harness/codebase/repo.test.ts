import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const mcpCallTool = vi.fn<
  (
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    config?: unknown,
    scopeKey?: string,
  ) => Promise<unknown>
>()

const ensureCodeGraph = vi.fn<(root: string) => Promise<void>>(async () => undefined)

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri({}))

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    callTool: (
      serverId: string,
      toolName: string,
      args: Record<string, unknown>,
      config?: unknown,
      scopeKey?: string,
    ) => mcpCallTool(serverId, toolName, args, config, scopeKey),
  },
}))

vi.mock('@/services/mcp/mcp-http-client', () => ({
  setMcpElicitationHandler: vi.fn<(handler: unknown) => unknown>((handler) => handler),
}))

vi.mock('@/services/mcp/mcp-auth-gate', () => ({
  requestMcpAuth: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/services/codegraph/ensure-codegraph', () => ({
  default: (root: string) => ensureCodeGraph(root),
}))

import codebaseSearch from '@/services/harness/codebase/search'
import codebaseStatus from '@/services/harness/codebase/status'

const api: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const web: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}

const baseCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot: '/tmp/api',
  projectSlug: 'stack',
  members: [api, web],
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  ...overrides,
})

const execute = async (
  built: { execute?: unknown },
  input: Record<string, unknown>,
): Promise<unknown> => {
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('codebase tool repo resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '**CodeGraph Status**\n\n**Files indexed:** 1' }],
    })
  })

  it('defaults codebase_status to the primary member root', async () => {
    await execute(codebaseStatus(baseCtx()), {})

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/api')
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_status',
      {},
      undefined,
      '/tmp/api',
    )
  })

  it('resolves codebase_search repo to that member root', async () => {
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: '' }] })
    await execute(codebaseSearch(baseCtx()), { query: 'Auth', repo: 'web' })

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/web')
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_search',
      { query: 'Auth' },
      undefined,
      '/tmp/web',
    )
  })

  it('rejects an unknown codebase_status repo slug', async () => {
    await expect(execute(codebaseStatus(baseCtx()), { repo: 'mobile' })).rejects.toThrow(
      'Unknown project slug. Valid slugs: api, web',
    )
    expect(mcpCallTool).not.toHaveBeenCalled()
  })

  it('does not start CodeGraph from the tool when members are absent', async () => {
    await execute(codebaseStatus(baseCtx({ members: undefined, projectSlug: 'api' })), {})

    expect(ensureCodeGraph).not.toHaveBeenCalled()
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_status',
      {},
      undefined,
      '/tmp/api',
    )
  })
})
