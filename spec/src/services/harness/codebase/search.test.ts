import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const callManagedCodegraphTool = vi.hoisted(() =>
  vi.fn<
    (
      ctx: unknown,
      args: {
        toolCallId: string
        firstPartyName: string
        mcpToolName: string
        toolArgs: Record<string, unknown>
        projectRoot: string
      },
    ) => Promise<{ ok: true; result: unknown } | { ok: false; payload: Record<string, unknown> }>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri({}))

vi.mock('@/services/harness/codebase/call-managed', () => ({
  default: (
    ctx: unknown,
    args: {
      toolCallId: string
      firstPartyName: string
      mcpToolName: string
      toolArgs: Record<string, unknown>
      projectRoot: string
    },
  ) => callManagedCodegraphTool(ctx, args),
}))

import codebaseSearch from '@/services/harness/codebase/search'

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

const searchText = (heading: string, hits: Array<{ symbol: string; path: string }>): string => {
  const blocks = hits.map((hit) => `**${hit.symbol}** (method)\n${hit.path}:1`)
  return [heading, '', ...blocks].join('\n')
}

describe('codebase_search exact vs fuzzy summaries', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the server summary when a result symbol contains the query', async () => {
    const summary = searchText('**Search Results (1 found)**', [
      { symbol: 'AuthService', path: 'src/auth.ts' },
    ])
    callManagedCodegraphTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: summary }] },
    })

    const result = await execute(codebaseSearch(baseCtx()), { query: 'auth' })

    expect(result).toMatchObject({
      repo: 'api',
      summary,
      results: [expect.objectContaining({ path: 'src/auth.ts', symbol: 'AuthService' })],
    })
  })

  it('rewrites the summary when hits are only fuzzy near-misses', async () => {
    const serverSummary = searchText('**Search Results (2 found)**', [
      { symbol: 'get', path: 'src/a.ts' },
      { symbol: 'get', path: 'src/b.ts' },
    ])
    callManagedCodegraphTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: serverSummary }] },
    })

    const result = await execute(codebaseSearch(baseCtx()), { query: 'Greet' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [
        expect.objectContaining({ path: 'src/a.ts', symbol: 'get' }),
        expect.objectContaining({ path: 'src/b.ts', symbol: 'get' }),
      ],
      summary:
        'No exact matches for "Greet"; showing 2 closest fuzzy matches in api (default repo; pass repo to search another member)',
    })
  })

  it('names the resolved repo on fuzzy matches in a multi-root workspace', async () => {
    const serverSummary = searchText('**Search Results (1 found)**', [
      { symbol: 'get', path: 'src/index.ts' },
    ])
    callManagedCodegraphTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: serverSummary }] },
    })

    const result = await execute(codebaseSearch(baseCtx()), { query: 'Greet', repo: 'web' })

    expect(callManagedCodegraphTool).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        mcpToolName: 'codegraph_search',
        toolArgs: { query: 'Greet' },
        projectRoot: '/tmp/web',
      }),
    )
    expect(result).toMatchObject({
      repo: 'web',
      summary: 'No exact matches for "Greet"; showing 1 closest fuzzy matches in web',
    })
  })

  it('leaves the empty-results path unchanged', async () => {
    callManagedCodegraphTool.mockResolvedValue({
      ok: true,
      result: { content: [{ type: 'text', text: 'Index is still building' }] },
    })

    const result = await execute(codebaseSearch(baseCtx()), { query: 'foo' })

    expect(result).toMatchObject({
      repo: 'api',
      results: [],
      summary:
        'Index is still building in api (default repo; pass repo to search another member)',
    })
  })
})
