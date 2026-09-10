<script setup lang="ts">
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CircleIcon,
  Loader2Icon,
  LogInIcon,
  PlayIcon,
  SettingsIcon,
  ShieldAlertIcon,
  SquareIcon,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import { isMcpServerEnabled } from '@/schemas/mcp-config'
import type { EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import connectionKey from '@/services/mcp/connection-key'

const props = defineProps<{
  server: EffectiveMcpServer
  scopeKey: string
}>()

const emit = defineEmits<{
  login: []
  settings: []
  toggle: [checked: boolean]
}>()

const { serverStates, loadingServers, authenticatingServers } = useMcpServers()

const stateKey = computed(() => connectionKey(props.scopeKey, props.server.id))

const serverStatus = computed(
  (): string => serverStates.value[stateKey.value]?.status ?? 'stopped',
)

const isLoading = computed(
  () =>
    loadingServers.value[stateKey.value] === true ||
    authenticatingServers.value[stateKey.value] === true,
)

const enabled = computed(() => isMcpServerEnabled(props.server.config))

const running = computed(
  () => enabled.value && serverStatus.value !== 'stopped',
)

const statusLabel = computed((): string => {
  if (isLoading.value) {
    return 'Loading'
  }
  if (!enabled.value) {
    return 'Disabled'
  }
  const status = serverStatus.value
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
})

const statusTooltip = computed((): string => {
  if (serverStatus.value === 'error') {
    const error = serverStates.value[stateKey.value]?.error
    if (error) {
      return error
    }
  }
  return statusLabel.value
})

const statusIconClass = computed((): string => {
  if (isLoading.value) {
    return 'text-muted-foreground'
  }
  if (!enabled.value) {
    return 'text-muted-foreground/50'
  }
  const status = serverStatus.value
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
})

const handleToggle = (): void => {
  emit('toggle', !running.value)
}
</script>

<template>
  <div class="flex items-center gap-1 rounded-md px-1.5 py-1.5">
    <McpServerIcon :server-id="server.id" :scope-key="scopeKey" class="ml-1" />
    <span class="min-w-0 flex-1 truncate px-1 text-sm font-medium">
      {{ server.id }}
    </span>

    <Tooltip v-if="enabled && serverStatus === 'auth_required'">
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-7 shrink-0 text-amber-600 dark:text-amber-400"
          :disabled="isLoading"
          :aria-label="`Log in to ${server.id}`"
          @click="emit('login')"
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
          @click="emit('settings')"
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
          :class="statusIconClass"
        >
          <Loader2Icon
            v-if="isLoading || serverStatus === 'starting' || serverStatus === 'refreshing'"
            class="size-3.5 animate-spin"
          />
          <CheckCircle2Icon
            v-else-if="enabled && serverStatus === 'connected'"
            class="size-3.5"
          />
          <AlertCircleIcon
            v-else-if="enabled && serverStatus === 'error'"
            class="size-3.5"
          />
          <ShieldAlertIcon
            v-else-if="enabled && serverStatus === 'auth_required'"
            class="size-3.5"
          />
          <CircleIcon
            v-else
            class="size-3.5"
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {{ statusTooltip }}
      </TooltipContent>
    </Tooltip>

    <Tooltip>
      <TooltipTrigger as-child>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="size-7 shrink-0"
          :class="running
            ? 'text-red-600 dark:text-red-400'
            : 'text-green-600 dark:text-green-400'"
          :disabled="isLoading"
          :aria-label="`${running ? 'Stop' : 'Start'} ${server.id}`"
          @click="handleToggle"
        >
          <SquareIcon v-if="running" class="size-3.5" />
          <PlayIcon v-else class="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {{ running ? `Stop ${server.id}` : `Start ${server.id}` }}
      </TooltipContent>
    </Tooltip>
  </div>
</template>
