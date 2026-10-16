import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useRouter } from 'vue-router'
import useProjectMcpConfig from '@/composables/mcp-servers/use-project-mcp-config'
import useMcpTrustChoice from '@/composables/mcp-servers/use-mcp-trust-choice'
import { canShowMcpOAuthLoginControl } from '@/types/vixl/mcp-config'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { McpTrustScope } from '@/types/harness/permission'
import connectionKey from '@/services/mcp/connection-key'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import {
  listUnionedMcpServers,
  type UnionedMcpServer,
} from '@/services/mcp/union-member-servers'
import { hasGroupMembers } from '@/utils/parse-member-qualified-name'
import {
  isMemberOwnedMcpPickerServer,
  mcpPickerMemberSetKey,
  mcpPickerServerMatchesQuery,
  mcpPickerSettingsTab,
  patchUnionMcpPickerRow,
  toSingleRootMcpPickerServer,
} from '@/components/chat/chat-mcp-server-picker'
import {
  applyChatMcpPickerEnabledChange,
  refreshChatMcpPickerStates,
  toastMcpPickerError,
} from '@/composables/mcp-servers/chat-mcp-server-picker-actions'
import useMcpServers from '@/composables/mcp-servers/store'
import useVixlConfig from '@/composables/use-vixl-config'
import useRootEffectiveSettings from '@/composables/use-root-effective-settings'
import { isMcpServerEnabled } from '@/schemas/mcp-config'

export default (options: {
  projectRoot: () => string | null
  members: () => HarnessWorkspaceMember[] | undefined
}) => {
  const {
    personalMcp,
    projectMcp,
    serverStates,
    setServerEnabled,
    authenticateServer,
    refreshStates,
    listUserMcpServers,
  } = useMcpServers()
  const config = useVixlConfig()
  const router = useRouter()
  const { localProjectConfig, reloadProjectConfig } = useProjectMcpConfig(
    options.projectRoot,
  )
  const { settings: trustSettings } = useRootEffectiveSettings(options.projectRoot)
  const trustRoot = ref<string | null>(options.projectRoot())
  const {
    trustPending,
    trustSaving,
    requireTrust,
    handleTrustChoice: resolveTrustChoice,
  } = useMcpTrustChoice(
    () => trustRoot.value,
  )

  const menuOpen = ref(false)
  const searchQuery = ref('')
  const unionRows = shallowRef<UnionedMcpServer[]>([])
  let unionGeneration = 0

  const isGroupWorkspace = computed(() => hasGroupMembers(options.members()))
  const memberSetKey = computed(() => mcpPickerMemberSetKey(options.members()))

  const pickerServers = computed((): UnionedMcpServer[] => {
    if (isGroupWorkspace.value) {
      return unionRows.value
    }
    return listUserMcpServers(personalMcp.value, localProjectConfig.value).map((server) =>
      toSingleRootMcpPickerServer(server, options.projectRoot()),
    )
  })

  const scopeForServer = (server: UnionedMcpServer): string => server.scopeKey

  const stateFor = (server: UnionedMcpServer) =>
    serverStates.value[connectionKey(scopeForServer(server), server.id)]

  const reloadUnionRows = async (): Promise<void> => {
    const generation = ++unionGeneration
    const members = options.members()
    if (!hasGroupMembers(members)) {
      unionRows.value = []
      return
    }
    const rows = await listUnionedMcpServers(options.projectRoot() ?? '', members)
    if (generation !== unionGeneration) {
      return
    }
    unionRows.value = rows
  }

  const refreshPickerStates = (): Promise<void> =>
    refreshChatMcpPickerStates(
      refreshStates,
      isGroupWorkspace.value,
      unionRows.value,
      options.projectRoot(),
    )

  const filteredServers = computed(() =>
    pickerServers.value.filter((server) =>
      mcpPickerServerMatchesQuery(server, searchQuery.value),
    ),
  )

  const connectedCount = computed(
    () =>
      pickerServers.value.filter(
        (server) => stateFor(server)?.status === 'connected',
      ).length,
  )

  const hasAuthRequired = computed(() =>
    pickerServers.value.some(
      (server) =>
        isMcpServerEnabled(server.config) &&
        stateFor(server)?.status === 'auth_required',
    ),
  )

  const runWithOwningTrustRoot = async (
    server: UnionedMcpServer,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (!isMemberOwnedMcpPickerServer(server)) {
      await action()
      return
    }
    const previous = trustRoot.value
    trustRoot.value = server.scopeKey
    try {
      await action()
    } finally {
      if (trustPending.value === null) {
        trustRoot.value = previous
      }
    }
  }

  const settingsForAction = async (server: UnionedMcpServer): Promise<VixlSettings> => {
    if (isMemberOwnedMcpPickerServer(server)) {
      return await loadEffectiveSettings(server.scopeKey)
    }
    return trustSettings.value
  }

  const refreshOnOpen = async (open: boolean): Promise<void> => {
    menuOpen.value = open
    if (!open) {
      return
    }
    searchQuery.value = ''
    try {
      if (isGroupWorkspace.value) {
        await reloadUnionRows()
      } else {
        await reloadProjectConfig()
      }
      await refreshPickerStates()
    } catch (error) {
      toastMcpPickerError('Failed to refresh MCP server status', error)
    }
  }

  const handleOpenInSettings = async (server: UnionedMcpServer): Promise<void> => {
    menuOpen.value = false
    try {
      await router.push({
        path: '/settings',
        query: {
          tab: mcpPickerSettingsTab(server),
          section: 'mcp',
        },
      })
    } catch (error) {
      toastMcpPickerError('Navigation failed', error)
    }
  }

  const applyEnabledChange = async (
    server: UnionedMcpServer,
    checked: boolean,
  ): Promise<void> =>
    applyChatMcpPickerEnabledChange({
      server,
      checked,
      projectRoot: options.projectRoot(),
      fleetRoot: config.activeRootPath.value,
      localProjectConfig,
      projectMcp,
      trustSettings: trustSettings.value,
      setServerEnabled,
      reloadUnionRows,
      refreshStates,
      isGroup: isGroupWorkspace.value,
      patchUnionRow: (row, enabled) => {
        unionRows.value = patchUnionMcpPickerRow(unionRows.value, row, enabled)
      },
    })

  const handleToggleChange = async (
    server: UnionedMcpServer,
    checked: boolean,
  ): Promise<void> => {
    if (checked) {
      await runWithOwningTrustRoot(server, () =>
        requireTrust(
          server.id,
          server.config,
          () => applyEnabledChange(server, true),
          scopeForServer(server),
        ),
      )
      return
    }
    await applyEnabledChange(server, false)
  }

  const handleLogin = async (server: UnionedMcpServer): Promise<void> => {
    const state = stateFor(server)
    if (
      !canShowMcpOAuthLoginControl(
        server.config,
        state?.status ?? 'stopped',
        state?.error,
      )
    ) {
      return
    }
    await runWithOwningTrustRoot(server, () =>
      requireTrust(server.id, server.config, async () => {
        try {
          const settings = await settingsForAction(server)
          await authenticateServer(server.id, server.config, {
            settings,
            scopeKey: scopeForServer(server),
          })
        } catch (error) {
          if (error instanceof Error && error.message === 'OAuth callback aborted') {
            return
          }
        }
      }, scopeForServer(server)),
    )
  }

  const handleTrustChoice = async (scope: McpTrustScope): Promise<void> => {
    try {
      await resolveTrustChoice(scope)
    } finally {
      trustRoot.value = options.projectRoot()
    }
  }

  const handleTrustDialogOpen = (open: boolean): void => {
    if (!open) {
      trustPending.value = null
      trustRoot.value = options.projectRoot()
    }
  }

  watch(
    () => options.projectRoot(),
    (root) => {
      if (trustPending.value === null) {
        trustRoot.value = root
      }
    },
  )

  watch(
    memberSetKey,
    async () => {
      unionRows.value = []
      if (!isGroupWorkspace.value) {
        return
      }
      try {
        await reloadUnionRows()
        await refreshPickerStates()
      } catch (error) {
        toastMcpPickerError('Failed to refresh MCP server status', error)
      }
    },
    { immediate: true },
  )

  onMounted(async () => {
    if (isGroupWorkspace.value) {
      return
    }
    try {
      await refreshPickerStates()
    } catch (error) {
      toastMcpPickerError('Failed to refresh MCP server status', error)
    }
  })

  return {
    menuOpen,
    searchQuery,
    pickerServers,
    filteredServers,
    connectedCount,
    hasAuthRequired,
    trustPending,
    trustSaving,
    trustRoot,
    scopeForServer,
    refreshOnOpen,
    handleOpenInSettings,
    handleToggleChange,
    handleLogin,
    handleTrustChoice,
    handleTrustDialogOpen,
  }
}
