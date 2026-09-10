<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { useColorMode } from '@vueuse/core'
import { Server } from '@lucide/vue'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/components/shadcn/ui/avatar'
import useMcpServers from '@/composables/use-mcp-servers'
import { parseConnectionKey } from '@/composables/mcp-servers/helpers'
import connectionKey from '@/services/mcp/connection-key'
import type { McpIcon } from '@/types/mcp/mcp-icon'
import type { McpServerState } from '@/services/vixl/vixl-tauri'
import resolveMcpServerIconSrc from '@/utils/resolve-mcp-server-icon-src'
import { cn } from '@/lib/utils'

const props = defineProps<{
  serverId: string
  scopeKey?: string | null
  class?: HTMLAttributes['class']
}>()

const { serverStates } = useMcpServers()
const colorMode = useColorMode()

const iconsForServer = (
  states: Record<string, McpServerState>,
  serverId: string,
  scopeKey?: string | null,
): McpIcon[] | null | undefined => {
  if (scopeKey !== undefined) {
    return states[connectionKey(scopeKey, serverId)]?.icons
  }

  let fallback: McpIcon[] | null | undefined
  for (const [key, state] of Object.entries(states)) {
    if (parseConnectionKey(key).serverId !== serverId && state.serverId !== serverId) {
      continue
    }
    if (state.status === 'connected' && state.icons && state.icons.length > 0) {
      return state.icons
    }
    if (fallback === undefined && state.icons) {
      fallback = state.icons
    }
  }
  return fallback
}

const iconTheme = computed((): 'light' | 'dark' | null => {
  if (colorMode.value === 'dark') return 'dark'
  if (colorMode.value === 'light') return 'light'
  return null
})

const src = computed((): string | null =>
  resolveMcpServerIconSrc(
    iconsForServer(serverStates.value, props.serverId, props.scopeKey),
    iconTheme.value,
  ),
)
</script>

<template>
  <Avatar :class="cn('size-4 shrink-0 rounded-sm', props.class)">
    <AvatarImage
      v-if="src"
      :src="src"
      :alt="props.serverId"
    />
    <AvatarFallback class="rounded-sm bg-transparent p-0">
      <Server class="size-3.5 text-muted-foreground" />
    </AvatarFallback>
  </Avatar>
</template>
