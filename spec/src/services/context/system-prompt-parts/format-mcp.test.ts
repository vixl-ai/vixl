import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import connectionKey from '@/services/mcp/connection-key'

const { readMcpConfig, mcpListStatuses } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, projectRoot: string | null) => Promise<unknown>>(),
  mcpListStatuses: vi.fn<(scopeKey?: string) => Promise<Record<string, unknown>>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
    mcpListStatuses,
  }),
)

import formatMcpCatalog from '@/services/context/system-prompt-parts/format-mcp'

const projectRoot = '/tmp/project'
const docsKey = connectionKey(projectRoot, 'docs')
const braveKey = connectionKey('personal', 'brave')

const connectedState = (
  serverId: string,
  toolName: string,
  description: string,
) => ({
  serverId,
  status: 'connected',
  tools: [{ name: toolName, description }],
  error: null,
})

describe('formatMcpCatalog', () => {
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
      return {
        servers: {
          docs: { command: 'npx', args: ['-y', 'docs-mcp'] },
        },
      }
    })
    mcpListStatuses.mockImplementation(async (scopeKey?: string) => {
      if (scopeKey === projectRoot) {
        return {
          [docsKey]: connectedState('docs', 'search_docs', 'Search project docs'),
        }
      }
      return {
        [braveKey]: connectedState('brave', 'brave_web_search', 'Search the web'),
      }
    })
  })

  it('shows a connected project-scoped stdio server as connected', async () => {
    const catalog = await formatMcpCatalog(projectRoot, false)

    expect(mcpListStatuses).toHaveBeenCalledWith()
    expect(mcpListStatuses).toHaveBeenCalledWith(projectRoot)
    expect(catalog).toContain('- docs (connected):')
    expect(catalog).toContain('search_docs: Search project docs')
    expect(catalog).not.toMatch(/- docs: not running/)
  })

  it('looks up personal servers by composite key', async () => {
    const catalog = await formatMcpCatalog(projectRoot, false)

    expect(catalog).toContain('- brave (connected):')
    expect(catalog).toContain('brave_web_search: Search the web')
  })
})
