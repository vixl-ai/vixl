import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { McpConfig, McpServerConfig } from '@/types/vixl/mcp-config'

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const loadProjectSettings = vi.hoisted(() =>
  vi.fn<(rootPath: string) => Promise<VixlSettings>>(),
)
const saveSettings = vi.hoisted(() =>
  vi.fn<(scope: string, settings: VixlSettings, rootPath?: string | null) => Promise<void>>(),
)
const loadEffectiveSettings = vi.hoisted(() =>
  vi.fn<(rootPath: string | null) => Promise<VixlSettings>>(),
)
const loadPersonalMcpConfig = vi.hoisted(() =>
  vi.fn<() => Promise<McpConfig>>(async () => ({ servers: {} })),
)
const loadProjectConfigForRoot = vi.hoisted(() =>
  vi.fn<(rootPath: string) => Promise<McpConfig>>(async () => ({ servers: {} })),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/services/config/vixl-config', () => ({
  loadProjectSettings,
  saveSettings,
  loadEffectiveSettings,
}))

vi.mock('@/composables/mcp-servers/config', () => ({
  loadPersonalMcpConfig,
  loadProjectConfigForRoot,
}))

import createApprovals from '@/composables/agent-harness/approvals'
import {
  requestMcpAuth,
  resetMcpAuthGateForTests,
} from '@/services/mcp/mcp-auth-gate'

const fleetProject = (rootPath: string, index: number): FleetProject => ({
  id: `p${index}`,
  name: `proj-${index}`,
  slug: `proj-${index}`,
  rootPath,
  lastOpened: '',
})

const buildState = (overrides?: {
  projectRoot?: string
  standalone?: boolean
  activeRootPath?: string | null
  fleetRoots?: string[]
}): {
  state: AgentHarnessState
  updateSetting: ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<void>>>
} => {
  const updateSetting = vi
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined)
  const projectSettings: VixlSettings = { version: 1 }
  const personalSettings: VixlSettings = { version: 1 }
  const chatRoot = overrides?.projectRoot ?? '/tmp/chat-root'
  const fleetRoots = overrides?.fleetRoots ?? [chatRoot]
  const state = {
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: chatRoot,
      projectName: 'proj',
      standalone: overrides?.standalone ?? false,
    },
    fleet: {
      projects: ref(fleetRoots.map(fleetProject)),
    },
    config: {
      activeRootPath: computed(() => overrides?.activeRootPath ?? '/tmp/fleet-root'),
      getScopeSettings: (tab: 'personal' | 'project') =>
        tab === 'personal' ? personalSettings : projectSettings,
      updateSetting,
    },
    mcpServers: {
      personalMcp: ref({ servers: {} }),
      projectMcp: ref({ servers: {} }),
      authenticateServer: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(
        undefined,
      ),
    },
    pendingApprovals: ref([]),
    pendingMcpAuth: ref([]),
    sessionPermissionLevel: ref(null),
    mcpAuthPollTimer: { current: null },
    status: ref('ready'),
  } as unknown as AgentHarnessState

  return { state, updateSetting }
}

const buildAttention = (): AttentionHelpers =>
  ({
    setChatAttention: vi.fn<(...args: unknown[]) => void>(),
    maybeClearAttentionWhenGatesEmpty: vi.fn<(...args: unknown[]) => void>(),
  }) as unknown as AttentionHelpers

describe('persistPermission workspace scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadProjectSettings.mockResolvedValue({ version: 1 })
    saveSettings.mockResolvedValue(undefined)
  })

  it('writes to the chat root when it differs from the fleet active root', async () => {
    const { state, updateSetting } = buildState({
      projectRoot: '/tmp/chat-root',
      activeRootPath: '/tmp/fleet-root',
    })
    const { persistPermission } = createApprovals(state, buildAttention())

    await persistPermission('fs.write', 'allow', 'workspace')

    expect(loadProjectSettings).toHaveBeenCalledWith('/tmp/chat-root')
    expect(saveSettings).toHaveBeenCalledWith(
      'project',
      expect.objectContaining({
        'agent.permissions': [
          { capability: 'fs.write', verdict: 'allow', scope: 'workspace' },
        ],
      }),
      '/tmp/chat-root',
    )
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('uses updateSetting when the chat root is the fleet active root', async () => {
    const { state, updateSetting } = buildState({
      projectRoot: '/tmp/fleet-root',
      activeRootPath: '/tmp/fleet-root',
    })
    const { persistPermission } = createApprovals(state, buildAttention())

    await persistPermission('fs.write', 'allow', 'workspace')

    expect(loadProjectSettings).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
    expect(updateSetting).toHaveBeenCalledWith(
      'project',
      'agent.permissions',
      [{ capability: 'fs.write', verdict: 'allow', scope: 'workspace' }],
    )
  })

  it('toasts when workspace scope has no chat root', async () => {
    const { state, updateSetting } = buildState({ standalone: true })
    const { persistPermission } = createApprovals(state, buildAttention())

    await persistPermission('fs.write', 'allow', 'workspace')

    expect(toastError).toHaveBeenCalledWith(
      'Cannot save workspace permission',
      expect.objectContaining({
        description: 'No active project is open.',
      }),
    )
    expect(updateSetting).not.toHaveBeenCalled()
    expect(saveSettings).not.toHaveBeenCalled()
  })
})

describe('authenticatePendingMcpAuth', () => {
  const personalServerConfig: McpServerConfig = {
    command: 'npx',
    args: ['-y', '@brave/brave-search-mcp-server'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetMcpAuthGateForTests()
    loadPersonalMcpConfig.mockResolvedValue({ servers: {} })
    loadProjectConfigForRoot.mockResolvedValue({ servers: {} })
    loadEffectiveSettings.mockResolvedValue({ version: 1 })
  })

  it('authenticates a personal-scope server when global mcp refs are empty', async () => {
    loadPersonalMcpConfig.mockResolvedValue({
      servers: { brave: personalServerConfig },
    })
    const { state } = buildState()
    state.pendingMcpAuth.value = [
      {
        chatId: 'chat-1',
        toolCallId: 'tool-1',
        serverId: 'brave',
        scopeKey: 'personal',
        kind: 'oauth',
        title: 'Authenticate Brave',
      },
    ]
    const { authenticatePendingMcpAuth } = createApprovals(state, buildAttention())

    await authenticatePendingMcpAuth('tool-1')

    expect(state.mcpServers.personalMcp.value.servers).toEqual({})
    expect(state.mcpServers.projectMcp.value.servers).toEqual({})
    expect(loadPersonalMcpConfig).toHaveBeenCalled()
    expect(loadProjectConfigForRoot).not.toHaveBeenCalled()
    expect(loadEffectiveSettings).toHaveBeenCalledWith(null)
    expect(state.mcpServers.authenticateServer).toHaveBeenCalledWith(
      'brave',
      personalServerConfig,
      expect.objectContaining({
        settings: { version: 1 },
        scopeKey: 'personal',
      }),
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('authenticates a project-scoped server with that scopeKey', async () => {
    const projectServerConfig: McpServerConfig = {
      command: 'npx',
      args: ['-y', 'docs-mcp'],
    }
    loadProjectConfigForRoot.mockResolvedValue({
      servers: { docs: projectServerConfig },
    })
    const { state } = buildState({ projectRoot: '/tmp/chat-root' })
    state.pendingMcpAuth.value = [
      {
        chatId: 'chat-1',
        toolCallId: 'tool-1',
        serverId: 'docs',
        scopeKey: '/tmp/chat-root',
        kind: 'oauth',
        title: 'Authenticate docs',
      },
    ]
    const { authenticatePendingMcpAuth } = createApprovals(state, buildAttention())

    await authenticatePendingMcpAuth('tool-1')

    expect(loadProjectConfigForRoot).toHaveBeenCalledWith('/tmp/chat-root')
    expect(loadEffectiveSettings).toHaveBeenCalledWith('/tmp/chat-root')
    expect(state.mcpServers.authenticateServer).toHaveBeenCalledWith(
      'docs',
      projectServerConfig,
      expect.objectContaining({
        settings: { version: 1 },
        scopeKey: '/tmp/chat-root',
      }),
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('loads the entry scope root when it differs from options.projectRoot', async () => {
    const projectServerConfig: McpServerConfig = {
      command: 'npx',
      args: ['-y', 'docs-mcp'],
    }
    loadProjectConfigForRoot.mockResolvedValue({
      servers: { docs: projectServerConfig },
    })
    const { state } = buildState({
      projectRoot: '/tmp/new-root',
      fleetRoots: ['/tmp/new-root', '/tmp/old-root'],
    })
    state.pendingMcpAuth.value = [
      {
        chatId: 'chat-1',
        toolCallId: 'tool-1',
        serverId: 'docs',
        scopeKey: '/tmp/old-root',
        kind: 'oauth',
        title: 'Authenticate docs',
      },
    ]
    const { authenticatePendingMcpAuth } = createApprovals(state, buildAttention())

    await authenticatePendingMcpAuth('tool-1')

    expect(loadProjectConfigForRoot).toHaveBeenCalledWith('/tmp/old-root')
    expect(loadEffectiveSettings).toHaveBeenCalledWith('/tmp/old-root')
    expect(state.mcpServers.authenticateServer).toHaveBeenCalledWith(
      'docs',
      projectServerConfig,
      expect.objectContaining({
        settings: { version: 1 },
        scopeKey: '/tmp/old-root',
      }),
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('cancels when the entry scope root is no longer a known project', async () => {
    const pending = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      serverId: 'docs',
      scopeKey: '/tmp/old-root',
      kind: 'oauth',
      title: 'Authenticate docs',
    })
    const { state } = buildState({
      projectRoot: '/tmp/new-root',
      fleetRoots: ['/tmp/new-root'],
    })
    const { authenticatePendingMcpAuth } = createApprovals(state, buildAttention())

    await authenticatePendingMcpAuth('tool-1')

    expect(toastError).toHaveBeenCalledWith(
      'MCP authentication cancelled',
      expect.objectContaining({
        description: 'The project for this MCP server is no longer available.',
      }),
    )
    await expect(pending).resolves.toEqual({ action: 'cancelled' })
    expect(loadProjectConfigForRoot).not.toHaveBeenCalled()
    expect(loadEffectiveSettings).not.toHaveBeenCalled()
    expect(state.mcpServers.authenticateServer).not.toHaveBeenCalled()
  })

  it('cancels when a project-scoped id now exists only in personal config', async () => {
    loadPersonalMcpConfig.mockResolvedValue({
      servers: { docs: personalServerConfig },
    })
    loadProjectConfigForRoot.mockResolvedValue({ servers: {} })
    const pending = requestMcpAuth({
      chatId: 'chat-1',
      toolCallId: 'tool-1',
      serverId: 'docs',
      scopeKey: '/tmp/chat-root',
      kind: 'oauth',
      title: 'Authenticate docs',
    })
    const { state } = buildState({ projectRoot: '/tmp/chat-root' })
    const { authenticatePendingMcpAuth } = createApprovals(state, buildAttention())

    await authenticatePendingMcpAuth('tool-1')

    expect(toastError).toHaveBeenCalledWith(
      'MCP authentication cancelled',
      expect.objectContaining({
        description: 'This MCP server is no longer configured for that scope.',
      }),
    )
    await expect(pending).resolves.toEqual({ action: 'cancelled' })
    expect(loadEffectiveSettings).not.toHaveBeenCalled()
    expect(state.mcpServers.authenticateServer).not.toHaveBeenCalled()
  })
})
