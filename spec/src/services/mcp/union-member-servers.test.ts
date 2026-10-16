import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { readMcpConfig } = vi.hoisted(() => ({
  readMcpConfig: vi.fn<(scope: string, projectRoot?: string | null) => Promise<unknown>>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readMcpConfig,
  }),
)

import {
  listUnionedMcpServers,
  resolveUnionedMcpServer,
} from '@/services/mcp/union-member-servers'

const apiRoot = '/tmp/api'
const webRoot = '/tmp/web'
const members = [
  { slug: 'api', name: 'API', rootPath: apiRoot },
  { slug: 'web', name: 'Web', rootPath: webRoot },
]

describe('union member MCP servers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readMcpConfig.mockImplementation(async (scope, rootPath) => {
      if (scope === 'personal') {
        return {
          servers: {
            brave: { command: 'npx', args: ['-y', 'brave'] },
          },
        }
      }
      if (rootPath === apiRoot) {
        return { servers: { docs: { command: 'npx', args: ['-y', 'api-docs'] } } }
      }
      if (rootPath === webRoot) {
        return {
          servers: {
            docs: { command: 'npx', args: ['-y', 'web-docs'] },
            search: { command: 'npx', args: ['-y', 'web-search'] },
          },
        }
      }
      return { servers: {} }
    })
  })

  it('keeps bare ids for a single project root', async () => {
    const servers = await listUnionedMcpServers(apiRoot, undefined)
    const docs = resolveUnionedMcpServer(servers, 'docs', undefined)
    expect(docs).toMatchObject({ id: 'docs', displayId: 'docs', scopeKey: apiRoot })
  })

  it('resolves a qualified duplicate to that member root', async () => {
    const servers = await listUnionedMcpServers(apiRoot, members)
    const resolved = resolveUnionedMcpServer(servers, 'api:docs', members)
    expect(resolved).toMatchObject({
      id: 'docs',
      displayId: 'api:docs',
      scopeKey: apiRoot,
      memberSlug: 'api',
    })
  })

  it('resolves a bare unique project server', async () => {
    const servers = await listUnionedMcpServers(apiRoot, members)
    const resolved = resolveUnionedMcpServer(servers, 'search', members)
    expect(resolved).toMatchObject({
      id: 'search',
      displayId: 'search',
      scopeKey: webRoot,
      memberSlug: 'web',
    })
  })

  it('errors on a bare name duplicated across members', async () => {
    const servers = await listUnionedMcpServers(apiRoot, members)
    const resolved = resolveUnionedMcpServer(servers, 'docs', members)
    expect(resolved).toEqual({
      error:
        'MCP server "docs" is defined in multiple projects. Use one of: api:docs, web:docs',
    })
  })

  it('still resolves personal servers by bare id', async () => {
    const servers = await listUnionedMcpServers(apiRoot, members)
    const resolved = resolveUnionedMcpServer(servers, 'brave', members)
    expect(resolved).toMatchObject({
      id: 'brave',
      displayId: 'brave',
      scopeKey: 'personal',
    })
  })
})
