<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/shadcn/ui/popover'
import { toast } from 'vue-sonner'
import useProjectMcpConfig from '@/composables/mcp-servers/use-project-mcp-config'
import useMcpTrustChoice from '@/composables/mcp-servers/use-mcp-trust-choice'
import { isMcpServerEnabled } from '@/schemas/mcp-config'
import type { EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import type { SettingsTab } from '@/composables/use-vixl-config'

const props = defineProps<{
  projectRoot: string | null
}>()

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
  () => props.projectRoot,
)
const { settings: trustSettings } = useRootEffectiveSettings(() => props.projectRoot)
const { trustPending, trustSaving, requireTrust, handleTrustChoice } = useMcpTrustChoice(
  () => props.projectRoot,
)

const menuOpen = ref(false)
const searchQuery = ref('')

const effectiveServers = computed(() =>
  listUserMcpServers(personalMcp.value, localProjectConfig.value),
)

const filteredServers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return effectiveServers.value
  }
  return effectiveServers.value.filter((server) => server.id.toLowerCase().includes(query))
})

const connectedCount = computed(
  () =>
    effectiveServers.value.filter((server) => serverStates.value[server.id]?.status === 'connected')
      .length,
)

const hasAuthRequired = computed(() =>
  effectiveServers.value.some(
    (server) =>
      isMcpServerEnabled(server.config) &&
      serverStates.value[server.id]?.status === 'auth_required',
  ),
)

const settingsTabForServer = (server: EffectiveMcpServer): SettingsTab =>
  server.scope === 'personal' ? 'personal' : 'project'

const refreshOnOpen = async (open: boolean): Promise<void> => {
  menuOpen.value = open
  if (!open) {
    return
  }
  searchQuery.value = ''
  try {
    await reloadProjectConfig()
    await refreshStates()
  } catch (error) {
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenInSettings = async (server: EffectiveMcpServer): Promise<void> => {
  menuOpen.value = false
  try {
    await router.push({
      path: '/settings',
      query: {
        tab: settingsTabForServer(server),
        section: 'mcp',
      },
    })
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const applyEnabledChange = async (
  server: EffectiveMcpServer,
  checked: boolean,
): Promise<void> => {
  const fleetRoot = config.activeRootPath.value
  const overrideConfig = localProjectConfig.value
  const useOverride =
    props.projectRoot !== fleetRoot && overrideConfig !== null

  try {
    const updated = await setServerEnabled(
      server.id,
      checked,
      props.projectRoot,
      useOverride ? overrideConfig : undefined,
      trustSettings.value,
    )
    if (updated) {
      localProjectConfig.value = updated
    } else if (props.projectRoot === fleetRoot) {
      localProjectConfig.value = projectMcp.value
    }
  } catch (error) {
    toast.error('Failed to update MCP server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleToggleChange = async (
  server: EffectiveMcpServer,
  checked: boolean,
): Promise<void> => {
  if (checked) {
    await requireTrust(server.id, server.config, () =>
      applyEnabledChange(server, true),
    )
    return
  }
  await applyEnabledChange(server, false)
}

const handleLogin = async (server: EffectiveMcpServer): Promise<void> => {
  await requireTrust(server.id, server.config, async () => {
    try {
      await authenticateServer(server.id, server.config, {
        settings: trustSettings.value,
      })
    } catch {
      return
    }
  })
}

const handleTrustDialogOpen = (open: boolean): void => {
  if (!open) {
    trustPending.value = null
  }
}

onMounted(async () => {
  try {
    await refreshStates()
  } catch (error) {
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})
</script>

<template>
  <Popover :open="menuOpen" @update:open="refreshOnOpen">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 gap-1.5 px-2 text-xs"
        :class="hasAuthRequired ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'"
        :title="`${connectedCount} of ${effectiveServers.length} MCP servers connected`"
        aria-label="MCP servers"
      >
        <AppIcon name="server" class="size-3.5 shrink-0" />
        <span class="max-w-32 min-w-0 truncate @max-[22rem]/composer:hidden">
          MCP
          <template v-if="effectiveServers.length > 0">
            ({{ connectedCount }}/{{ effectiveServers.length }})
          </template>
        </span>
        <AppIcon name="chevron-down" class="size-3 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 p-0">
      <div class="border-b border-border/50 p-2">
        <Input v-model="searchQuery" placeholder="Search MCP servers…" class="h-8" />
      </div>
      <div class="max-h-60 overflow-y-auto p-1">
        <p
          v-if="filteredServers.length === 0"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          {{ searchQuery.trim() ? 'No servers match your search.' : 'No MCP servers configured.' }}
        </p>
        <ChatMcpServerPickerItem
          v-for="server in filteredServers"
          :key="server.id"
          :server="server"
          @login="handleLogin(server)"
          @settings="handleOpenInSettings(server)"
          @toggle="(checked) => handleToggleChange(server, checked)"
        />
      </div>
    </PopoverContent>
  </Popover>
  <TrustServerDialog
    :open="trustPending !== null"
    :server-id="trustPending?.serverId ?? null"
    :saving="trustSaving"
    :show-workspace="props.projectRoot !== null"
    @update:open="handleTrustDialogOpen"
    @choice="handleTrustChoice"
  />
</template>
