import { toast } from 'vue-sonner'
import type { Ref, ShallowRef } from 'vue'
import { loadProjectConfigForRoot } from '@/composables/mcp-servers/config'
import {
  isMemberOwnedMcpPickerServer,
  mcpPickerSettingsTab,
  unionMcpPickerProjectScopeKeys,
} from '@/components/chat/chat-mcp-server-picker'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import type { UnionedMcpServer } from '@/services/mcp/union-member-servers'
import type { McpConfig } from '@/types/vixl/mcp-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { SettingsTab } from '@/composables/use-vixl-config'

export const toastMcpPickerError = (title: string, error: unknown): void => {
  toast.error(title, {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

export const refreshChatMcpPickerStates = async (
  refreshStates: (scopeKey?: string | null) => Promise<void>,
  isGroup: boolean,
  unionRows: UnionedMcpServer[],
  projectRoot: string | null,
): Promise<void> => {
  await refreshStates('personal')
  if (isGroup) {
    for (const scopeKey of unionMcpPickerProjectScopeKeys(unionRows)) {
      await refreshStates(scopeKey)
    }
    return
  }
  if (projectRoot) {
    await refreshStates(projectRoot)
  }
}

export const applyChatMcpPickerEnabledChange = async (args: {
  server: UnionedMcpServer
  checked: boolean
  projectRoot: string | null
  fleetRoot: string | null
  localProjectConfig: ShallowRef<McpConfig | null>
  projectMcp: Ref<McpConfig>
  trustSettings: VixlSettings
  setServerEnabled: (
    serverId: string,
    enabled: boolean,
    tab: SettingsTab,
    rootPath: string | null,
    projectConfigOverride?: McpConfig,
    settings?: VixlSettings,
  ) => Promise<McpConfig | undefined>
  reloadUnionRows: () => Promise<void>
  refreshStates: (scopeKey?: string | null) => Promise<void>
  isGroup: boolean
  patchUnionRow: (server: UnionedMcpServer, checked: boolean) => void
}): Promise<void> => {
  const { server, checked } = args
  if (isMemberOwnedMcpPickerServer(server)) {
    try {
      const memberRoot = server.scopeKey
      const memberConfig = await loadProjectConfigForRoot(memberRoot)
      const memberSettings = await loadEffectiveSettings(memberRoot)
      const updated = await args.setServerEnabled(
        server.id,
        checked,
        'project',
        memberRoot,
        memberConfig,
        memberSettings,
      )
      if (updated) {
        if (memberRoot === args.fleetRoot) {
          args.projectMcp.value = updated
        }
        if (memberRoot === args.projectRoot) {
          args.localProjectConfig.value = updated
        }
      }
      if (args.isGroup) {
        args.patchUnionRow(server, checked)
      }
      await args.reloadUnionRows()
      await args.refreshStates(memberRoot)
    } catch (error) {
      toastMcpPickerError('Failed to update MCP server', error)
    }
    return
  }

  const overrideConfig = args.localProjectConfig.value
  const useOverride =
    args.projectRoot !== args.fleetRoot && overrideConfig !== null

  try {
    const updated = await args.setServerEnabled(
      server.id,
      checked,
      mcpPickerSettingsTab(server),
      args.projectRoot,
      useOverride ? overrideConfig : undefined,
      args.trustSettings,
    )
    if (updated) {
      args.localProjectConfig.value = updated
    } else if (args.projectRoot === args.fleetRoot) {
      args.localProjectConfig.value = args.projectMcp.value
    }
    if (args.isGroup) {
      args.patchUnionRow(server, checked)
      await args.reloadUnionRows()
      await args.refreshStates('personal')
    }
  } catch (error) {
    toastMcpPickerError('Failed to update MCP server', error)
  }
}
