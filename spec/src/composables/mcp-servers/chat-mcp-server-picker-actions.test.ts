import { ref, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { UnionedMcpServer } from '@/services/mcp/union-member-servers'
import type { McpConfig } from '@/types/vixl/mcp-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { SettingsTab } from '@/composables/use-vixl-config'
import {
  applyChatMcpPickerEnabledChange,
  refreshChatMcpPickerStates,
} from '@/composables/mcp-servers/chat-mcp-server-picker-actions'

vi.mock('@/composables/mcp-servers/config', () => ({
  loadProjectConfigForRoot: vi.fn<(rootPath: string) => Promise<McpConfig>>(async () => ({
    servers: { docs: { command: 'npx', args: ['-y', 'api-docs'] } },
  })),
}))

vi.mock('@/services/config/vixl-config', () => ({
  loadEffectiveSettings: vi.fn<(rootPath: string | null) => Promise<VixlSettings>>(
    async () => ({ version: 1 }),
  ),
}))

const stdio = { command: 'npx', args: ['-y', 'example'] }

const rows: UnionedMcpServer[] = [
  {
    id: 'brave',
    displayId: 'brave',
    scope: 'personal',
    scopeKey: 'personal',
    config: stdio,
  },
  {
    id: 'docs',
    displayId: 'docs',
    scope: 'project',
    scopeKey: '/tmp/api',
    config: stdio,
    memberSlug: 'api',
  },
  {
    id: 'search',
    displayId: 'search',
    scope: 'project',
    scopeKey: '/tmp/web',
    config: stdio,
    memberSlug: 'web',
  },
]

describe('refreshChatMcpPickerStates', () => {
  it('refreshes personal then the single project root', async () => {
    const refreshStates = vi.fn<(scopeKey?: string | null) => Promise<void>>(async () => {})
    await refreshChatMcpPickerStates(refreshStates, false, rows, '/tmp/vixl')
    expect(refreshStates.mock.calls.map((call) => call[0])).toEqual([
      'personal',
      '/tmp/vixl',
    ])
  })

  it('refreshes personal then each distinct member scope in a group', async () => {
    const refreshStates = vi.fn<(scopeKey?: string | null) => Promise<void>>(async () => {})
    await refreshChatMcpPickerStates(refreshStates, true, rows, '/tmp/api')
    expect(refreshStates.mock.calls.map((call) => call[0])).toEqual([
      'personal',
      '/tmp/api',
      '/tmp/web',
    ])
  })
})

const personal = rows[0]!
const apiDocs = rows[1]!
const webSearch = rows[2]!
const toggledProjectConfig: McpConfig = {
  servers: {
    docs: { command: 'npx', args: ['-y', 'api-docs'], enabled: false },
  },
}

const emptyArgs = () => {
  const reloadUnionRows = vi.fn<() => Promise<void>>(async () => {})
  const refreshStates = vi.fn<(scopeKey?: string | null) => Promise<void>>(async () => {})
  const setServerEnabled = vi.fn<(
    serverId: string,
    enabled: boolean,
    tab: SettingsTab,
    rootPath: string | null,
    projectConfigOverride?: McpConfig,
    settings?: VixlSettings,
  ) => Promise<McpConfig | undefined>>(async () => undefined)
  return {
    reloadUnionRows,
    refreshStates,
    setServerEnabled,
    localProjectConfig: shallowRef<McpConfig | null>(null),
    projectMcp: ref<McpConfig>({ servers: {} }),
    patchUnionRow: vi.fn<(server: UnionedMcpServer, checked: boolean) => void>(),
  }
}

describe('applyChatMcpPickerEnabledChange', () => {
  it('reloads union rows and personal states after a personal toggle in group mode', async () => {
    const deps = emptyArgs()
    await applyChatMcpPickerEnabledChange({
      server: personal,
      checked: false,
      projectRoot: '/tmp/api',
      fleetRoot: '/tmp/api',
      localProjectConfig: deps.localProjectConfig,
      projectMcp: deps.projectMcp,
      trustSettings: { version: 1 },
      setServerEnabled: deps.setServerEnabled,
      reloadUnionRows: deps.reloadUnionRows,
      refreshStates: deps.refreshStates,
      isGroup: true,
      patchUnionRow: deps.patchUnionRow,
    })
    expect(deps.patchUnionRow).toHaveBeenCalledWith(personal, false)
    expect(deps.reloadUnionRows).toHaveBeenCalledTimes(1)
    expect(deps.refreshStates).toHaveBeenCalledWith('personal')
  })

  it('does not reload union rows after a personal toggle in single-root mode', async () => {
    const deps = emptyArgs()
    await applyChatMcpPickerEnabledChange({
      server: personal,
      checked: false,
      projectRoot: '/tmp/api',
      fleetRoot: '/tmp/api',
      localProjectConfig: deps.localProjectConfig,
      projectMcp: deps.projectMcp,
      trustSettings: { version: 1 },
      setServerEnabled: deps.setServerEnabled,
      reloadUnionRows: deps.reloadUnionRows,
      refreshStates: deps.refreshStates,
      isGroup: false,
      patchUnionRow: deps.patchUnionRow,
    })
    expect(deps.patchUnionRow).not.toHaveBeenCalled()
    expect(deps.reloadUnionRows).not.toHaveBeenCalled()
    expect(deps.refreshStates).not.toHaveBeenCalled()
  })

  it('syncs projectMcp when a member toggle is the fleet active root', async () => {
    const deps = emptyArgs()
    deps.setServerEnabled.mockResolvedValue(toggledProjectConfig)
    await applyChatMcpPickerEnabledChange({
      server: apiDocs,
      checked: false,
      projectRoot: '/tmp/api',
      fleetRoot: '/tmp/api',
      localProjectConfig: deps.localProjectConfig,
      projectMcp: deps.projectMcp,
      trustSettings: { version: 1 },
      setServerEnabled: deps.setServerEnabled,
      reloadUnionRows: deps.reloadUnionRows,
      refreshStates: deps.refreshStates,
      isGroup: true,
      patchUnionRow: deps.patchUnionRow,
    })
    expect(deps.patchUnionRow).toHaveBeenCalledWith(apiDocs, false)
    expect(deps.projectMcp.value).toEqual(toggledProjectConfig)
    expect(deps.localProjectConfig.value).toEqual(toggledProjectConfig)
    expect(deps.reloadUnionRows).toHaveBeenCalledTimes(1)
    expect(deps.refreshStates).toHaveBeenCalledWith('/tmp/api')
  })

  it('leaves projectMcp untouched when a member toggle is not the fleet active root', async () => {
    const deps = emptyArgs()
    deps.setServerEnabled.mockResolvedValue(toggledProjectConfig)
    const original = deps.projectMcp.value
    await applyChatMcpPickerEnabledChange({
      server: webSearch,
      checked: false,
      projectRoot: '/tmp/api',
      fleetRoot: '/tmp/api',
      localProjectConfig: deps.localProjectConfig,
      projectMcp: deps.projectMcp,
      trustSettings: { version: 1 },
      setServerEnabled: deps.setServerEnabled,
      reloadUnionRows: deps.reloadUnionRows,
      refreshStates: deps.refreshStates,
      isGroup: true,
      patchUnionRow: deps.patchUnionRow,
    })
    expect(deps.patchUnionRow).toHaveBeenCalledWith(webSearch, false)
    expect(deps.projectMcp.value).toBe(original)
    expect(deps.localProjectConfig.value).toBeNull()
    expect(deps.reloadUnionRows).toHaveBeenCalledTimes(1)
    expect(deps.refreshStates).toHaveBeenCalledWith('/tmp/web')
  })
})
