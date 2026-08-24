<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldAlert,
  Square,
  Trash2,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { Badge } from '@/components/shadcn/ui/badge'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/shadcn/ui/empty'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import SettingsMcpManageMcpServerDialog from '@/components/settings/mcp/ManageMcpServerDialog.vue'
import ChatMcpSecretsForm from '@/components/chat/ChatMcpSecretsForm.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import useMcpServers from '@/composables/use-mcp-servers'
import type { SettingsTab } from '@/composables/use-vixl-config'
import type { McpConfig, McpInputDefinition, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer } from '@/types/vixl/mcp-config'
import type { McpTrustScope } from '@/types/harness/permission'
import { isMcpServerEnabled } from '@/schemas/mcp-config'
import {
  isMcpTrusted,
  sessionTrusts,
  upsertMcpTrustRecord,
  clearSessionTrust,
} from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { clearMcpToolBaseline } from '@/services/mcp/mcp-tool-baseline'
import {
  listRequiredInputIdsForServer,
  loadMcpInputValues,
  saveMcpInputValues,
} from '@/services/mcp/resolve-mcp-inputs'

const props = defineProps<{
  tab: SettingsTab
}>()

const config = useVixlConfig()
const {
  personalMcp,
  projectMcp,
  serverStates,
  loadingServers,
  authenticatingServers,
  startServer,
  refreshServer,
  refreshAllServers,
  authenticateServer,
  logoutServer,
  upsertServer,
  deleteServer,
  setServerEnabled,
  listScopedMcpServers,
  refreshStates,
} = useMcpServers()

type TrustPending = {
  serverId: string
  fingerprint: string
  action: () => Promise<void>
}

const expanded = ref<Record<string, boolean>>({})
const refreshingAll = ref(false)
const manageOpen = ref(false)
const manageMode = ref<'create' | 'edit'>('create')
const manageServerId = ref<string | null>(null)
const secretsOpen = ref(false)
const secretsServerId = ref<string | null>(null)
const secretsConfigured = ref<Record<string, boolean>>({})
const asConfirmOpen = ref(false)
const asConfirmOrigin = ref('')
const asConfirmResolve = ref<((confirmed: boolean) => void) | null>(null)
const trustPending = ref<TrustPending | null>(null)
const trustSaving = ref(false)

const scopedServers = computed(() =>
  listScopedMcpServers(personalMcp.value, projectMcp.value, props.tab),
)

const scopedMcpConfig = computed((): McpConfig =>
  props.tab === 'personal' ? personalMcp.value : projectMcp.value,
)

const manageInitialConfig = computed((): McpServerConfig | null => {
  if (!manageServerId.value) {
    return null
  }
  return scopedMcpConfig.value.servers[manageServerId.value] ?? null
})

const secretsServerConfig = computed((): McpServerConfig | null => {
  if (!secretsServerId.value) {
    return null
  }
  return scopedMcpConfig.value.servers[secretsServerId.value] ?? null
})

const toggleExpanded = (id: string): void => {
  expanded.value[id] = !expanded.value[id]
}

const isAuthCapableServer = (serverConfig: McpServerConfig): boolean =>
  isMcpHttpServer(serverConfig)

const serverStatus = (id: string): string =>
  serverStates.value[id]?.status ?? 'stopped'

const isServerLoading = (id: string): boolean =>
  loadingServers.value[id] === true || authenticatingServers.value[id] === true

const isServerRunning = (id: string, serverConfig: McpServerConfig): boolean =>
  isMcpServerEnabled(serverConfig) && serverStatus(id) !== 'stopped'

const showAuthControl = (serverConfig: McpServerConfig, id: string): boolean => {
  const status = serverStatus(id)
  if (status === 'auth_required') {
    return true
  }
  if (isAuthCapableServer(serverConfig) && status === 'connected') {
    return true
  }
  return false
}

const refreshSecretsBadges = async (): Promise<void> => {
  const next: Record<string, boolean> = {}
  for (const server of scopedServers.value) {
    const ids = listRequiredInputIdsForServer(server.config)
    if (ids.length === 0) {
      next[server.id] = false
      continue
    }
    const { missing } = await loadMcpInputValues(server.id, ids)
    next[server.id] = missing.length === 0
  }
  secretsConfigured.value = next
}

const confirmAsOrigin = (origin: string): Promise<boolean> =>
  new Promise((resolve) => {
    asConfirmOrigin.value = origin
    asConfirmResolve.value = resolve
    asConfirmOpen.value = true
  })

const handleAsConfirm = (confirmed: boolean): void => {
  asConfirmOpen.value = false
  const resolve = asConfirmResolve.value
  asConfirmResolve.value = null
  resolve?.(confirmed)
}

const requireTrust = async (
  id: string,
  serverConfig: McpServerConfig,
  action: () => Promise<void>,
): Promise<void> => {
  const fingerprint = mcpServerFingerprint(serverConfig)
  if (isMcpTrusted(config.effectiveSettings.value, id, fingerprint, sessionTrusts)) {
    await action()
    return
  }
  trustPending.value = { serverId: id, fingerprint, action }
}

const handleTrustChoice = async (scope: McpTrustScope): Promise<void> => {
  const pending = trustPending.value
  if (!pending) {
    return
  }
  trustPending.value = null
  trustSaving.value = true

  try {
    await clearMcpToolBaseline(pending.serverId)

    if (scope === 'never') {
      clearSessionTrust(pending.serverId)
      const existing = config.personalSettings.value['agent.mcp.trust'] ?? []
      await config.updateSetting(
        'personal',
        'agent.mcp.trust',
        upsertMcpTrustRecord(existing, pending.serverId, 'never', pending.fingerprint),
      )
      return
    }

    if (scope === 'session') {
      sessionTrusts.set(pending.serverId, pending.fingerprint)
    } else if (scope === 'workspace') {
      const rootPath = config.activeRootPath.value
      if (rootPath) {
        const existing = config.projectSettings.value['agent.mcp.trust'] ?? []
        await config.updateSetting(
          'project',
          'agent.mcp.trust',
          upsertMcpTrustRecord(
            existing,
            pending.serverId,
            'workspace',
            pending.fingerprint,
          ),
        )
      } else {
        const existing = config.personalSettings.value['agent.mcp.trust'] ?? []
        await config.updateSetting(
          'personal',
          'agent.mcp.trust',
          upsertMcpTrustRecord(
            existing,
            pending.serverId,
            'always',
            pending.fingerprint,
          ),
        )
      }
      sessionTrusts.set(pending.serverId, pending.fingerprint)
    } else {
      const existing = config.personalSettings.value['agent.mcp.trust'] ?? []
      await config.updateSetting(
        'personal',
        'agent.mcp.trust',
        upsertMcpTrustRecord(
          existing,
          pending.serverId,
          'always',
          pending.fingerprint,
        ),
      )
      sessionTrusts.set(pending.serverId, pending.fingerprint)
    }

    await pending.action()
  } catch (error) {
    toast.error('Failed to trust server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    trustSaving.value = false
  }
}

const handleEnabledChange = async (
  id: string,
  enabled: boolean,
  serverConfig: McpServerConfig,
): Promise<void> => {
  if (isServerLoading(id)) {
    return
  }
  if (enabled) {
    await requireTrust(id, serverConfig, async () => {
      try {
        await setServerEnabled(id, true, config.activeRootPath.value)
      } catch (error) {
        toast.error('Failed to update MCP server', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    })
    return
  }
  try {
    await setServerEnabled(id, false, config.activeRootPath.value)
  } catch (error) {
    toast.error('Failed to update MCP server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleRefreshServer = async (
  id: string,
  serverConfig: McpServerConfig,
): Promise<void> => {
  if (isServerLoading(id)) {
    return
  }
  const status = serverStatus(id)
  if (status === 'connected' || status === 'error' || status === 'refreshing') {
    await refreshServer(id, serverConfig)
    return
  }
  await requireTrust(id, serverConfig, () => startServer(id, serverConfig))
}

const handleAuthAction = async (
  id: string,
  serverConfig: McpServerConfig,
): Promise<void> => {
  if (serverStatus(id) === 'auth_required') {
    await requireTrust(id, serverConfig, async () => {
      try {
        await authenticateServer(id, serverConfig, {
          confirmAuthorizationServerOrigin: confirmAsOrigin,
        })
      } catch {
        // authenticateServer already toasts.
      }
    })
    return
  }
  await logoutServer(id, serverConfig)
}

const openCreateServer = (): void => {
  manageMode.value = 'create'
  manageServerId.value = null
  manageOpen.value = true
}

const openEditServer = (id: string): void => {
  manageMode.value = 'edit'
  manageServerId.value = id
  manageOpen.value = true
}

const openSecrets = (id: string): void => {
  secretsServerId.value = id
  secretsOpen.value = true
}

const handleDeleteServer = async (id: string): Promise<void> => {
  if (!scopedMcpConfig.value.servers[id]) {
    return
  }
  try {
    await deleteServer(props.tab, id, config.activeRootPath.value)
  } catch (error) {
    toast.error('Failed to delete MCP server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleManageSave = async (payload: {
  serverId: string
  previousId?: string
  config: McpServerConfig
  inputs: McpInputDefinition[]
  secretValues: Record<string, string>
}): Promise<void> => {
  try {
    await upsertServer(
      props.tab,
      payload.serverId,
      payload.config,
      config.activeRootPath.value,
      {
        previousId: payload.previousId,
        inputs: payload.inputs,
      },
    )
    if (Object.keys(payload.secretValues).length > 0) {
      await saveMcpInputValues(payload.serverId, payload.secretValues)
    }
    toast.success(manageMode.value === 'create' ? 'Server saved' : 'Server updated')
    await refreshSecretsBadges()
  } catch (error) {
    toast.error('Failed to save MCP server', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

onMounted(async () => {
  try {
    await refreshStates()
    await refreshSecretsBadges()
  } catch (error) {
    toast.error('Failed to refresh MCP server status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

const refreshAll = async (): Promise<void> => {
  if (refreshingAll.value) {
    return
  }
  refreshingAll.value = true
  try {
    await refreshAllServers(
      scopedServers.value.map((server) => ({ id: server.id, config: server.config })),
    )
  } finally {
    refreshingAll.value = false
  }
}
</script>

<template>
  <SettingsSectionScroll title="MCP">
    <template #actions>
      <div class="flex items-center gap-0.5">
        <Tooltip v-if="scopedServers.length > 0">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              aria-label="Refresh all"
              :disabled="refreshingAll"
              @click="refreshAll"
            >
              <Loader2
                v-if="refreshingAll"
                class="h-4 w-4 animate-spin"
              />
              <RefreshCw
                v-else
                class="h-4 w-4"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh all</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-8 w-8"
              aria-label="Add server"
              @click="openCreateServer"
            >
              <Plus class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Add server</TooltipContent>
        </Tooltip>
      </div>
    </template>

    <Empty
      v-if="scopedServers.length === 0"
      class="border border-border/60 py-12"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Server />
        </EmptyMedia>
        <EmptyTitle>No MCP</EmptyTitle>
      </EmptyHeader>
    </Empty>

    <div
      v-else
      class="space-y-2"
    >
      <div
        v-for="server in scopedServers"
        :key="server.id"
        class="rounded-lg border border-border/50"
      >
        <div class="flex flex-wrap items-center gap-2 px-4 py-2">
          <button
            class="flex min-w-0 items-center gap-2"
            :disabled="isServerLoading(server.id)"
            @click="toggleExpanded(server.id)"
          >
            <ChevronDown
              v-if="expanded[server.id]"
              class="h-4 w-4 shrink-0"
            />
            <ChevronRight
              v-else
              class="h-4 w-4 shrink-0"
            />
            <McpServerIcon :server-id="server.id" />
            <span class="truncate font-medium">{{ server.id }}</span>
            <Loader2
              v-if="isServerLoading(server.id) || serverStatus(server.id) === 'starting' || serverStatus(server.id) === 'refreshing'"
              class="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground"
            />
            <CheckCircle2
              v-else-if="isMcpServerEnabled(server.config) && serverStatus(server.id) === 'connected'"
              class="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
            <AlertCircle
              v-else-if="isMcpServerEnabled(server.config) && serverStatus(server.id) === 'error'"
              class="h-3.5 w-3.5 shrink-0 text-destructive"
            />
            <ShieldAlert
              v-else-if="isMcpServerEnabled(server.config) && serverStatus(server.id) === 'auth_required'"
              class="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <Circle
              v-else
              class="h-3.5 w-3.5 shrink-0 text-muted-foreground/50"
            />
          </button>
          <Badge
            v-if="!isServerLoading(server.id) && serverStates[server.id]?.tools?.length"
            variant="outline"
          >
            {{ serverStates[server.id]?.tools?.length }} tools
          </Badge>
          <Badge
            v-if="secretsConfigured[server.id]"
            variant="secondary"
          >
            Secrets configured
          </Badge>
          <Badge
            v-if="serverStatus(server.id) === 'connected' && isAuthCapableServer(server.config)"
            variant="outline"
          >
            OAuth connected
          </Badge>
          <div class="ml-auto flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="Edit server"
                  @click="openEditServer(server.id)"
                >
                  <Pencil class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit server</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="Edit secrets"
                  @click="openSecrets(server.id)"
                >
                  <KeyRound class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Edit secrets</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="Refresh server"
                  :disabled="isServerLoading(server.id)"
                  @click="handleRefreshServer(server.id, server.config)"
                >
                  <RefreshCw class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh server</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :class="isServerRunning(server.id, server.config)
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-green-600 dark:text-green-400'"
                  :disabled="isServerLoading(server.id)"
                  :aria-label="`${isServerRunning(server.id, server.config) ? 'Stop' : 'Start'} ${server.id}`"
                  @click="handleEnabledChange(server.id, !isServerRunning(server.id, server.config), server.config)"
                >
                  <Square
                    v-if="isServerRunning(server.id, server.config)"
                    class="h-4 w-4"
                  />
                  <Play
                    v-else
                    class="h-4 w-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  isServerRunning(server.id, server.config)
                    ? `Stop ${server.id}`
                    : `Start ${server.id}`
                }}
              </TooltipContent>
            </Tooltip>
            <Tooltip v-if="showAuthControl(server.config, server.id)">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :aria-label="serverStatus(server.id) === 'auth_required' ? 'Log in' : 'Log out'"
                  @click="handleAuthAction(server.id, server.config)"
                >
                  <LogIn
                    v-if="serverStatus(server.id) === 'auth_required'"
                    class="h-4 w-4"
                  />
                  <LogOut
                    v-else
                    class="h-4 w-4"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{ serverStatus(server.id) === 'auth_required' ? 'Log in' : 'Log out' }}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label="Delete server"
                  @click="handleDeleteServer(server.id)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete server</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <div
          v-if="expanded[server.id] && !isServerLoading(server.id)"
          class="border-t border-border/50 px-4 py-3"
        >
          <div
            v-for="tool in serverStates[server.id]?.tools ?? []"
            :key="tool.name"
            class="py-2 text-sm"
          >
            <p class="font-mono">
              {{ tool.name }}
            </p>
            <p class="text-muted-foreground">
              {{ tool.description }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <SettingsMcpManageMcpServerDialog
      v-model:open="manageOpen"
      :mode="manageMode"
      :server-id="manageServerId"
      :initial-config="manageInitialConfig"
      :mcp-config="scopedMcpConfig"
      @save="handleManageSave"
    />

    <Dialog
      :open="secretsOpen"
      @update:open="(open) => (secretsOpen = open)"
    >
      <DialogContent class="sm:max-w-lg">
        <ChatMcpSecretsForm
          v-if="secretsServerId && secretsServerConfig"
          :server-id="secretsServerId"
          :server-config="secretsServerConfig"
          :mcp-config="scopedMcpConfig"
          :show-oauth-actions="isAuthCapableServer(secretsServerConfig)"
          :oauth-status="serverStatus(secretsServerId)"
          @saved="refreshSecretsBadges"
          @sign-in="secretsServerId && secretsServerConfig && handleAuthAction(secretsServerId, secretsServerConfig)"
          @log-out="secretsServerId && logoutServer(secretsServerId, secretsServerConfig ?? undefined)"
        />
      </DialogContent>
    </Dialog>

    <Dialog
      :open="asConfirmOpen"
      @update:open="(open) => { if (!open) handleAsConfirm(false) }"
    >
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Confirm authorization server</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          Allow OAuth with origin
          <span class="font-mono text-foreground">{{ asConfirmOrigin }}</span>?
          Only confirm origins you trust.
        </p>
        <DialogFooter class="flex-col gap-2 sm:flex-col">
          <Button
            class="w-full"
            @click="handleAsConfirm(true)"
          >
            Trust this authorization server
          </Button>
          <Button
            variant="ghost"
            class="w-full"
            @click="handleAsConfirm(false)"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      :open="trustPending !== null"
      @update:open="(open) => { if (!open) trustPending = null }"
    >
      <DialogContent class="max-w-sm">
        <DialogHeader>
          <DialogTitle>Trust MCP server?</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 text-sm text-muted-foreground">
          <p>
            <span class="inline-flex items-center gap-2 font-mono font-medium text-foreground">
              <McpServerIcon
                v-if="trustPending?.serverId"
                :server-id="trustPending.serverId"
              />
              {{ trustPending?.serverId }}
            </span>
            is an MCP server that can execute code on your machine (for example via npx or uvx).
            Choose how much you trust this exact command or URL.
          </p>
          <p class="text-xs">
            Untrusted servers cannot be started or called by agents. Changing the command, args, or URL
            requires trust again.
          </p>
        </div>
        <DialogFooter class="flex-col gap-2 sm:flex-col">
          <Button
            class="w-full"
            :disabled="trustSaving"
            @click="handleTrustChoice('session')"
          >
            This session
          </Button>
          <Button
            v-if="config.activeRootPath.value"
            variant="outline"
            class="w-full"
            :disabled="trustSaving"
            @click="handleTrustChoice('workspace')"
          >
            This workspace
          </Button>
          <Button
            variant="outline"
            class="w-full"
            :disabled="trustSaving"
            @click="handleTrustChoice('always')"
          >
            Always
          </Button>
          <Button
            variant="ghost"
            class="w-full text-destructive hover:text-destructive"
            :disabled="trustSaving"
            @click="handleTrustChoice('never')"
          >
            Never
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsSectionScroll>
</template>
