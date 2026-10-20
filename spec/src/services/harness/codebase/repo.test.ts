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

const fleetState = vi.hoisted(() => ({
  activeProjectId: { value: null as string | null },
  projects: [] as Array<{
    id: string
    name: string
    slug: string
    rootPath: string
    lastOpened: string
    worktree?: { parentId: string; branch: string; managed: boolean }
  }>,
}))

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri({}))

vi.mock('@/composables/use-fleet-registry', () => ({
  getActiveFleetProjectId: () => fleetState.activeProjectId.value,
  getFleetProjects: () => fleetState.projects,
}))

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

import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import codebaseExplore from '@/services/harness/codebase/explore'
import codebaseImpact from '@/services/harness/codebase/impact'
import { repoScopeSummary, withRepoSlug } from '@/services/harness/codebase/repo'
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
    fleetState.activeProjectId.value = null
    fleetState.projects = []
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: '**CodeGraph Status**\n\n**Files indexed:** 1' }],
    })
  })

  it('defaults codebase_status to the primary member root', async () => {
    const result = await execute(codebaseStatus(baseCtx()), {})

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/api')
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_status',
      {},
      undefined,
      '/tmp/api',
    )
    expect(result).toMatchObject({ repo: 'api', ready: true, filesIndexed: 1 })
  })

  it('resolves codebase_search repo to that member root', async () => {
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: '' }] })
    const result = await execute(codebaseSearch(baseCtx()), { query: 'Auth', repo: 'web' })

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/web')
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_search',
      { query: 'Auth' },
      undefined,
      '/tmp/web',
    )
    expect(result).toMatchObject({
      repo: 'web',
      results: [],
      summary: 'No structured CodeGraph results in web',
    })
  })

  it('keeps empty-search server text and appends the default repo', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Index is still building' }],
    })
    const result = await execute(codebaseSearch(baseCtx()), { query: 'foo' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'Index is still building in api (default repo; pass repo to search another member)',
    })
  })

  it('synthesizes a scoped no-results search summary when the server sent no text', async () => {
    vi.spyOn(normalizeCodegraphResult, 'tool').mockReturnValueOnce({ results: [] })
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: '' }] })
    const result = await execute(codebaseSearch(baseCtx()), { query: 'foo' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'No results found for "foo" in api (default repo; pass repo to search another member)',
    })
  })

  it('keeps search hits and includes the resolved repo', async () => {
    const text = [
      '**Search Results (1 found)**',
      '',
      '**Auth** (function)',
      'src/auth.ts:1',
    ].join('\n')
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text }] })
    const result = await execute(codebaseSearch(baseCtx()), { query: 'Auth' })

    expect(result).toMatchObject({
      repo: 'api',
      summary: text,
      results: [expect.objectContaining({ path: 'src/auth.ts', symbol: 'Auth' })],
    })
  })

  it('names the default repo when codebase_search fails', async () => {
    mcpCallTool.mockRejectedValue(new Error('offline'))
    const result = await execute(codebaseSearch(baseCtx()), { query: 'Auth' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary: 'offline in api (default repo; pass repo to search another member)',
    })
  })

  it('keeps empty-explore server text and appends the default repo', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Index is still building' }],
    })
    const result = await execute(codebaseExplore(baseCtx()), { query: 'AuthService' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'Index is still building in api (default repo; pass repo to explore another member)',
    })
  })

  it('names an explicit repo on empty-explore server text', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Index is still building' }],
    })
    const result = await execute(codebaseExplore(baseCtx()), {
      query: 'AuthService',
      repo: 'web',
    })

    expect(result).toMatchObject({
      repo: 'web',
      results: [],
      summary: 'Index is still building in web',
    })
  })

  it('synthesizes a scoped no-results explore summary when the server sent no text', async () => {
    vi.spyOn(normalizeCodegraphResult, 'tool').mockReturnValueOnce({ results: [] })
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: '' }] })
    const result = await execute(codebaseExplore(baseCtx()), { query: 'AuthService' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'No results found for "AuthService" in api (default repo; pass repo to explore another member)',
    })
  })

  it('keeps empty-impact server text and appends the default repo', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Symbol is not indexed yet' }],
    })
    const result = await execute(codebaseImpact(baseCtx()), { symbol: 'Auth' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'Symbol is not indexed yet in api (default repo; pass repo to analyze another member)',
    })
  })

  it('names an explicit repo on empty-impact server text', async () => {
    mcpCallTool.mockResolvedValue({
      content: [{ type: 'text', text: 'Symbol is not indexed yet' }],
    })
    const result = await execute(codebaseImpact(baseCtx()), { symbol: 'Auth', repo: 'web' })

    expect(result).toMatchObject({
      repo: 'web',
      results: [],
      summary: 'Symbol is not indexed yet in web',
    })
  })

  it('synthesizes a scoped no-results impact summary when the server sent no text', async () => {
    vi.spyOn(normalizeCodegraphResult, 'impact').mockReturnValueOnce({ results: [] })
    mcpCallTool.mockResolvedValue({ content: [{ type: 'text', text: '' }] })
    const result = await execute(codebaseImpact(baseCtx()), { symbol: 'Auth' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'No results found for "Auth" in api (default repo; pass repo to analyze another member)',
    })
  })

  it('names the default repo when codebase_status fails', async () => {
    mcpCallTool.mockRejectedValue(new Error('offline'))
    const result = await execute(codebaseStatus(baseCtx()), {})

    expect(result).toMatchObject({
      repo: 'api',
      ready: false,
      indexing: false,
      syncing: false,
      error: 'offline in api (default repo; pass repo to check another member)',
    })
  })

  it('rejects an unknown codebase_status repo slug', async () => {
    await expect(execute(codebaseStatus(baseCtx()), { repo: 'mobile' })).rejects.toThrow(
      'Unknown project slug. Valid slugs: api, web',
    )
    expect(mcpCallTool).not.toHaveBeenCalled()
  })

  it('does not start CodeGraph from the tool when members are absent', async () => {
    const result = await execute(
      codebaseStatus(baseCtx({ members: undefined, projectSlug: 'api' })),
      {},
    )

    expect(ensureCodeGraph).not.toHaveBeenCalled()
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_status',
      {},
      undefined,
      '/tmp/api',
    )
    expect(result).not.toHaveProperty('repo')
  })

  it('starts CodeGraph for a registered worktree root that is not the active fleet project', async () => {
    fleetState.activeProjectId.value = 'parent'
    fleetState.projects = [
      {
        id: 'parent',
        name: 'Parent',
        slug: 'parent',
        rootPath: '/tmp/parent',
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'worktree',
        name: 'feature',
        slug: 'feature',
        rootPath: '/tmp/worktrees/parent/feature',
        lastOpened: '2026-01-02T00:00:00.000Z',
        worktree: {
          parentId: 'parent',
          branch: 'vixl/feature',
          managed: true,
        },
      },
    ]

    const result = await execute(
      codebaseStatus(
        baseCtx({
          members: undefined,
          projectSlug: 'feature',
          projectRoot: '/tmp/worktrees/parent/feature',
        }),
      ),
      {},
    )

    expect(ensureCodeGraph).toHaveBeenCalledWith('/tmp/worktrees/parent/feature')
    expect(mcpCallTool).toHaveBeenCalledWith(
      'codegraph',
      'codegraph_status',
      {},
      undefined,
      '/tmp/worktrees/parent/feature',
    )
    expect(result).not.toHaveProperty('repo')
  })
})

describe('repoScopeSummary', () => {
  it('returns the base when no slug was resolved', () => {
    expect(
      repoScopeSummary(baseCtx(), undefined, undefined, 'search', 'No results found for "foo"'),
    ).toBe('No results found for "foo"')
  })

  it('names the default repo in a multi-root workspace', () => {
    expect(
      repoScopeSummary(baseCtx(), undefined, 'api', 'search', 'No results found for "foo"'),
    ).toBe(
      'No results found for "foo" in api (default repo; pass repo to search another member)',
    )
  })

  it('names an explicit repo without the default hint', () => {
    expect(repoScopeSummary(baseCtx(), 'web', 'web', 'search', 'No results found for "foo"')).toBe(
      'No results found for "foo" in web',
    )
  })
})

describe('withRepoSlug', () => {
  it('attaches repo when a slug is present', () => {
    expect(withRepoSlug('api', { results: [] })).toEqual({ results: [], repo: 'api' })
  })

  it('leaves the payload unchanged when slug is missing', () => {
    expect(withRepoSlug(undefined, { results: [] })).toEqual({ results: [] })
  })
})
