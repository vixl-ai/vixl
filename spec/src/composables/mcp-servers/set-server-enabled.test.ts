import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { personalMcp, projectMcp } from '@/composables/mcp-servers/state'
import { createSetServerEnabled } from '@/composables/mcp-servers/crud'

const { writeMcpConfig, setMcpServerEnabled, stopServer, refreshStates } = vi.hoisted(() => ({
  writeMcpConfig: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  setMcpServerEnabled: vi.fn<
    (
      scope: string,
      serverId: string,
      enabled: boolean,
      rootPath?: string | null,
    ) => Promise<boolean>
  >(async () => true),
  stopServer: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  refreshStates: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    writeMcpConfig,
    setMcpServerEnabled,
  }),
)

vi.mock('@/composables/mcp-servers/lifecycle', () => ({
  createStartServer: vi.fn<(...args: unknown[]) => unknown>(),
  stopServer: (...args: unknown[]) => stopServer(...args),
}))

vi.mock('@/composables/mcp-servers/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/composables/mcp-servers/config')>()
  return {
    ...actual,
    refreshStates: (...args: unknown[]) => refreshStates(...args),
  }
})

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const stdioServer = (enabled: boolean): McpServerConfig => ({
  command: 'npx',
  args: ['-y', 'example-mcp'],
  enabled,
})

describe('createSetServerEnabled', () => {
  beforeEach(() => {
    writeMcpConfig.mockClear()
    setMcpServerEnabled.mockClear()
    setMcpServerEnabled.mockResolvedValue(true)
    stopServer.mockClear()
    refreshStates.mockClear()
    personalMcp.value = { servers: {} }
    projectMcp.value = { servers: {} }
  })

  it('patches project scope without a full mcp.json rewrite and starts the server', async () => {
    const existing = stdioServer(false)
    projectMcp.value = {
      servers: { github: existing },
      inputs: [{ id: 'token', type: 'promptString' }],
    }
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    await setServerEnabled('github', true, 'project', '/tmp/project')

    expect(setMcpServerEnabled).toHaveBeenCalledWith(
      'project',
      'github',
      true,
      '/tmp/project',
    )
    expect(writeMcpConfig).not.toHaveBeenCalled()
    expect(startServer).toHaveBeenCalledWith(
      'github',
      { ...existing, enabled: true },
      { quiet: true, manageLoading: false, scopeKey: '/tmp/project' },
    )
    expect(stopServer).not.toHaveBeenCalled()
    expect(refreshStates).toHaveBeenCalledOnce()
    expect(projectMcp.value.inputs).toEqual([{ id: 'token', type: 'promptString' }])
    expect(projectMcp.value.servers.github?.enabled).toBe(true)
  })

  it('patches personal scope without a full mcp.json rewrite and stops the server', async () => {
    const existing = stdioServer(true)
    personalMcp.value = {
      servers: { filesystem: existing },
      inputs: [{ id: 'home', type: 'promptString' }],
    }
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    await setServerEnabled('filesystem', false, 'personal', '/tmp/project')

    expect(setMcpServerEnabled).toHaveBeenCalledWith(
      'personal',
      'filesystem',
      false,
      '/tmp/project',
    )
    expect(writeMcpConfig).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    expect(stopServer).toHaveBeenCalledWith('filesystem', {
      quiet: true,
      manageLoading: false,
      scopeKey: 'personal',
    })
    expect(refreshStates).toHaveBeenCalledOnce()
    expect(personalMcp.value.inputs).toEqual([{ id: 'home', type: 'promptString' }])
    expect(personalMcp.value.servers.filesystem?.enabled).toBe(false)
  })

  it('reverts in-memory state and rethrows when the surgical patch fails', async () => {
    const existing = stdioServer(true)
    personalMcp.value = { servers: { filesystem: existing } }
    setMcpServerEnabled.mockRejectedValue(new Error('disk full'))
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    await expect(setServerEnabled('filesystem', false, 'personal', null)).rejects.toThrow('disk full')

    expect(writeMcpConfig).not.toHaveBeenCalled()
    expect(startServer).not.toHaveBeenCalled()
    expect(stopServer).not.toHaveBeenCalled()
    expect(personalMcp.value.servers.filesystem).toEqual(existing)
  })

  it('uses a project config override without clobbering the global project ref', async () => {
    const globalExisting = stdioServer(true)
    const overrideExisting = stdioServer(false)
    projectMcp.value = { servers: { slack: globalExisting } }
    const override = { servers: { github: overrideExisting } }
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    const updated = await setServerEnabled(
      'github',
      true,
      'project',
      '/tmp/other-project',
      override,
    )

    expect(setMcpServerEnabled).toHaveBeenCalledWith(
      'project',
      'github',
      true,
      '/tmp/other-project',
    )
    expect(projectMcp.value.servers.slack).toEqual(globalExisting)
    expect(projectMcp.value.servers.github).toBeUndefined()
    expect(updated?.servers.github?.enabled).toBe(true)
    expect(startServer).toHaveBeenCalledWith(
      'github',
      { ...overrideExisting, enabled: true },
      { quiet: true, manageLoading: false, scopeKey: '/tmp/other-project' },
    )
  })

  it('does not roll back the global project ref when an override toggle fails', async () => {
    const globalExisting = stdioServer(true)
    projectMcp.value = { servers: { slack: globalExisting } }
    setMcpServerEnabled.mockRejectedValue(new Error('disk full'))
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    await expect(
      setServerEnabled(
        'github',
        true,
        'project',
        '/tmp/other-project',
        { servers: { github: stdioServer(false) } },
      ),
    ).rejects.toThrow('disk full')

    expect(projectMcp.value.servers.slack).toEqual(globalExisting)
    expect(projectMcp.value.servers.github).toBeUndefined()
  })

  it('passes a settings override through to startServer', async () => {
    const existing = stdioServer(false)
    projectMcp.value = { servers: { github: existing } }
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )
    const settings = { version: 1 as const, 'agent.mcp.trust': [] }

    await setServerEnabled('github', true, 'project', '/tmp/project', undefined, settings)

    expect(startServer).toHaveBeenCalledWith(
      'github',
      { ...existing, enabled: true },
      { quiet: true, manageLoading: false, scopeKey: '/tmp/project', settings },
    )
  })

  it('toggles the personal connection when the same id is overridden in project', async () => {
    const personalExisting = stdioServer(true)
    const projectExisting = stdioServer(true)
    personalMcp.value = { servers: { github: personalExisting } }
    projectMcp.value = { servers: { github: projectExisting } }
    const startServer = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})
    const setServerEnabled = createSetServerEnabled(
      vi.fn<(serverId: string, serverConfig: McpServerConfig) => void>(),
      startServer,
    )

    await setServerEnabled('github', false, 'personal', '/tmp/project')

    expect(setMcpServerEnabled).toHaveBeenCalledWith(
      'personal',
      'github',
      false,
      '/tmp/project',
    )
    expect(stopServer).toHaveBeenCalledWith('github', {
      quiet: true,
      manageLoading: false,
      scopeKey: 'personal',
    })
    expect(startServer).not.toHaveBeenCalled()
    expect(personalMcp.value.servers.github?.enabled).toBe(false)
    expect(projectMcp.value.servers.github).toEqual(projectExisting)
  })
})
