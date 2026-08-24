import { describe, expect, it } from 'vitest'
import stripCodegraphMcpServer from '@/services/codegraph/strip-codegraph-mcp-server'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import type { McpConfig } from '@/types/vixl/mcp-config'

describe('stripCodegraphMcpServer', () => {
  it('removes reserved codegraph without clobbering other servers', () => {
    const existing: McpConfig = {
      servers: {
        brave: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
          enabled: true,
        },
        [CODEGRAPH_SERVER_ID]: {
          command: 'npx',
          args: ['-y', '@colbymchenry/codegraph', 'serve', '--mcp'],
          enabled: true,
        },
      },
      inputs: [{ id: 'token', type: 'promptString', password: true }],
    }

    const stripped = stripCodegraphMcpServer(existing)

    expect(stripped.servers.brave).toEqual(existing.servers.brave)
    expect(stripped.inputs).toEqual(existing.inputs)
    expect(stripped.servers[CODEGRAPH_SERVER_ID]).toBeUndefined()
  })

  it('returns the same config when codegraph is absent', () => {
    const existing: McpConfig = {
      servers: {
        brave: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-brave-search'],
        },
      },
    }

    expect(stripCodegraphMcpServer(existing)).toBe(existing)
  })
})
