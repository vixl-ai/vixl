import { describe, expect, it } from 'vitest'
import { defaultMcpConfig, migrateMcpConfig } from '@/schemas/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'

describe('migrateMcpConfig', () => {
  it('returns default for non-objects', () => {
    expect(migrateMcpConfig(null)).toEqual(defaultMcpConfig())
    expect(migrateMcpConfig('nope')).toEqual(defaultMcpConfig())
  })

  it('migrates servers with inputs and oauth', () => {
    const migrated = migrateMcpConfig({
      servers: {
        local: {
          command: 'npx',
          args: ['-y', 'server'],
          env: { TOKEN: '${input:token}' },
        },
        remote: {
          type: 'http',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer ${input:token}' },
          oauth: {
            clientId: 'client-1',
            allowedAuthorizationServers: ['https://auth.example.com'],
          },
        },
      },
      inputs: [
        {
          id: 'token',
          type: 'promptString',
          description: 'API token',
          password: true,
        },
      ],
    })

    expect(Object.keys(migrated.servers)).toEqual(['local', 'remote'])
    expect(isMcpStdioServer(migrated.servers.local!)).toBe(true)
    const remote = migrated.servers.remote!
    expect(isMcpHttpServer(remote)).toBe(true)
    if (!isMcpHttpServer(remote)) {
      throw new Error('expected remote to be an HTTP MCP server')
    }
    expect(remote.oauth?.clientId).toBe('client-1')
    expect(migrated.inputs).toEqual([
      {
        id: 'token',
        type: 'promptString',
        description: 'API token',
        password: true,
      },
    ])
  })

  it('recovers valid servers when oauth or inputs are malformed', () => {
    const migrated = migrateMcpConfig({
      servers: {
        good: {
          type: 'sse',
          url: 'https://mcp.example.com/sse',
        },
        badOauth: {
          type: 'http',
          url: 'https://mcp.example.com/http',
          oauth: { clientId: 123 },
        },
        badStdio: {
          command: '',
        },
        stdio: {
          command: 'uvx',
          args: ['mcp-server'],
        },
      },
      inputs: [{ id: 'x' }, 'not-an-input'],
    })

    expect(Object.keys(migrated.servers).sort()).toEqual(['good', 'stdio'])
    expect(migrated.inputs).toBeUndefined()
  })

  it('keeps stdio and http shapes distinct', () => {
    const migrated = migrateMcpConfig({
      servers: {
        stdio: { command: 'node', args: ['server.js'] },
        http: { type: 'http', url: 'https://example.com/mcp' },
      },
    })

    expect(isMcpStdioServer(migrated.servers.stdio!)).toBe(true)
    expect(isMcpHttpServer(migrated.servers.stdio!)).toBe(false)
    expect(isMcpHttpServer(migrated.servers.http!)).toBe(true)
    expect(isMcpStdioServer(migrated.servers.http!)).toBe(false)
  })
})
