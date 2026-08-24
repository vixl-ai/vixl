<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  Loader2Icon,
  LogInIcon,
  PlayIcon,
  ServerIcon,
  SettingsIcon,
  ShieldAlertIcon,
  SquareIcon,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { toast } from 'vue-sonner'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import useMcpServers from '@/composables/use-mcp-servers'
import useVixlConfig from '@/composables/use-vixl-config'
import { isMcpServerEnabled } from '@/schemas/mcp-config'
import type { EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import { isMcpTrusted, sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import type { SettingsTab } from '@/composables/use-vixl-config'

const {
  personalMcp,
  projectMcp,
  serverStates,
  loadingServers,
  authenticatingServers,
  setServerEnabled,
  authenticateServer,
  refreshStates,
  listUserMcpServers,
} = useMcpServers()
const config = useVixlConfig()
const router = useRouter()

const menuOpen = ref(false)
const searchQuery = ref('')

const effectiveServers = computed(() =>
  listUserMcpServers(personalMcp.value, projectMcp.value),
)

const filteredServers = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return effectiveServers.value
  }
  return effectiveServers.value.filter((server) =>
    server.id.toLowerCase().includes(query),
  )
})

const connectedCount = computed(
  () =>
    effectiveServers.value.filter(
      (server) => serverStates.value[server.id]?.status === 'connected',
    ).length,
)

const hasAuthRequired = computed(() =>
  effectiveServers.value.some(
    (server) =>
      isMcpServerEnabled(server.config) &&
      serverStates.value[server.id]?.status === 'auth_required',
  ),
)

const serverStatus = (serverId: string): string =>
  serverStates.value[serverId]?.status ?? 'stopped'

const isServerLoading = (serverId: string): boolean =>
  loadingServers.value[serverId] === true ||
  authenticatingServers.value[serverId] === true

const isServerEnabled = (server: EffectiveMcpServer): boolean =>
  isMcpServerEnabled(server.config)

const isServerRunning = (server: EffectiveMcpServer): boolean =>
  isServerEnabled(server) && serverStatus(server.id) !== 'stopped'

const statusLabel = (server: EffectiveMcpServer): string => {
  if (isServerLoading(server.id)) {
    return 'Loading'
  }
  if (!isServerEnabled(server)) {
    return 'Disabled'
  }
  const status = serverStatus(server.id)
  if (status === 'connected') {
    return 'Connected'
  }
  if (status === 'error') {
    return 'Error'
  }
  if (status === 'starting' || status === 'refreshing') {
    return 'Starting'
  }
  if (status === 'auth_required') {
    return 'Auth required'
  }
  return 'Stopped'
}

const statusIconClass = (server: EffectiveMcpServer): string => {
  if (isServerLoading(server.id)) {
    return 'text-muted-foreground'
  }
  if (!isServerEnabled(server)) {
    return 'text-muted-foreground/50'
  }
  const status = serverStatus(server.id)
  if (status === 'connected') {
    return 'text-emerald-600 dark:text-emerald-400'
  }
  if (status === 'error') {
    return 'text-destructive'
  }
  if (status === 'starting' || status === 'refreshing') {
    return 'text-muted-foreground'
  }
  if (status === 'auth_required') {
    return 'text-amber-600 dark:text-amber-400'
  }
  return 'text-muted-foreground'
}

const settingsTabForServer = (server: EffectiveMcpServer): SettingsTab =>
  server.scope === 'personal' ? 'personal' : 'project'

const refreshOnOpen = async (open: boolean): Promise<void> => {
  menuOpen.value = open
  if (!open) {
    return
  }
  searchQuery.value = ''
  try {
    await refreshStates()
  } catch (error) {
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
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

const handleToggleChange = async (
  server: EffectiveMcpServer,
  checked: boolean,
): Promise<void> => {
  if (isServerLoading(server.id)) {
    return
  }
  if (checked === isServerRunning(server)) {
    return
  }

  if (
    checked &&
    !isMcpTrusted(
      config.effectiveSettings.value,
      server.id,
      mcpServerFingerprint(server.config),
      sessionTrusts,
    )
  ) {
    toast.error('Trust this server in Settings first', {
      description: `${server.id} must be trusted before it can be enabled.`,
    })
    await handleOpenInSettings(server)
    return
  }

  try {
    await setServerEnabled(server.id, checked, config.activeRootPath.value)
  } catch (error) {
    toast.error('Failed to update MCP server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleLogin = async (server: EffectiveMcpServer): Promise<void> => {
  if (isServerLoading(server.id)) {
    return
  }
  if (
    !isMcpTrusted(
      config.effectiveSettings.value,
      server.id,
      mcpServerFingerprint(server.config),
      sessionTrusts,
    )
  ) {
    toast.error('Trust this server in Settings first', {
      description: `${server.id} must be trusted before authentication.`,
    })
    await handleOpenInSettings(server)
    return
  }
  try {
    await authenticateServer(server.id, server.config)
  } catch {
    // authenticateServer already toasts.
  }
}
</script>

<template>
  <Popover :open="menuOpen" @update:open="refreshOnOpen">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 gap-1.5 px-2 text-xs"
        :class="
          hasAuthRequired
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground'
        "
        :title="`${connectedCount} of ${effectiveServers.length} MCP servers connected`"
        aria-label="MCP servers"
      >
        <ServerIcon class="size-3.5 shrink-0" />
        <span class="max-w-32 min-w-0 truncate @max-[22rem]/composer:hidden">
          MCP
          <template v-if="effectiveServers.length > 0">
            ({{ connectedCount }}/{{ effectiveServers.length }})
          </template>
        </span>
        <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 p-0">
      <div class="border-b border-border/50 p-2">
        <Input
          v-model="searchQuery"
          placeholder="Search MCP servers…"
          class="h-8"
        />
      </div>
      <div class="max-h-60 overflow-y-auto p-1">
        <p
          v-if="filteredServers.length === 0"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          {{
            searchQuery.trim()
              ? 'No servers match your search.'
              : 'No MCP servers configured.'
          }}
        </p>
        <div
          v-for="server in filteredServers"
          :key="server.id"
          class="flex items-center gap-1 rounded-md px-1.5 py-1.5"
        >
          <McpServerIcon
            :server-id="server.id"
            class="ml-1"
          />
          <span class="min-w-0 flex-1 truncate px-1 text-sm font-medium">
            {{ server.id }}
          </span>

          <Tooltip v-if="isServerEnabled(server) && serverStatus(server.id) === 'auth_required'">
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7 shrink-0 text-amber-600 dark:text-amber-400"
                :disabled="isServerLoading(server.id)"
                :aria-label="`Log in to ${server.id}`"
                @click="handleLogin(server)"
              >
                <LogInIcon class="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Log in</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7 shrink-0 text-muted-foreground"
                :aria-label="`Show ${server.id} in settings`"
                @click="handleOpenInSettings(server)"
              >
                <SettingsIcon class="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Show in settings</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <span
                class="inline-flex size-7 shrink-0 items-center justify-center"
                :class="statusIconClass(server)"
              >
                <Loader2Icon
                  v-if="isServerLoading(server.id) || serverStatus(server.id) === 'starting' || serverStatus(server.id) === 'refreshing'"
                  class="size-3.5 animate-spin"
                />
                <CheckCircle2Icon
                  v-else-if="isServerEnabled(server) && serverStatus(server.id) === 'connected'"
                  class="size-3.5"
                />
                <AlertCircleIcon
                  v-else-if="isServerEnabled(server) && serverStatus(server.id) === 'error'"
                  class="size-3.5"
                />
                <ShieldAlertIcon
                  v-else-if="isServerEnabled(server) && serverStatus(server.id) === 'auth_required'"
                  class="size-3.5"
                />
                <CircleIcon
                  v-else
                  class="size-3.5"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {{ statusLabel(server) }}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="size-7 shrink-0"
                :class="isServerRunning(server)
                  ? 'text-red-600 dark:text-red-400'
                  : 'text-green-600 dark:text-green-400'"
                :disabled="isServerLoading(server.id)"
                :aria-label="`${isServerRunning(server) ? 'Stop' : 'Start'} ${server.id}`"
                @click="handleToggleChange(server, !isServerRunning(server))"
              >
                <SquareIcon v-if="isServerRunning(server)" class="size-3.5" />
                <PlayIcon v-else class="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {{ isServerRunning(server) ? `Stop ${server.id}` : `Start ${server.id}` }}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </PopoverContent>
  </Popover>
</template>
