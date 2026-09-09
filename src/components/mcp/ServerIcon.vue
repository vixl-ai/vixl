<script setup lang="ts">
import { AppIcon } from '@/icons'
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { useColorMode } from '@vueuse/core'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/shadcn/ui/avatar'
import useMcpServers from '@/composables/use-mcp-servers'
import resolveMcpServerIconSrc from '@/utils/resolve-mcp-server-icon-src'
import { cn } from '@/lib/utils'

const props = defineProps<{
  serverId: string
  class?: HTMLAttributes['class']
}>()

const { serverStates } = useMcpServers()
const colorMode = useColorMode()

const iconTheme = computed((): 'light' | 'dark' | null => {
  if (colorMode.value === 'dark') return 'dark'
  if (colorMode.value === 'light') return 'light'
  return null
})

const src = computed((): string | null =>
  resolveMcpServerIconSrc(serverStates.value[props.serverId]?.icons, iconTheme.value),
)
</script>

<template>
  <Avatar :class="cn('size-4 shrink-0 rounded-sm', props.class)">
    <AvatarImage v-if="src" :src="src" :alt="props.serverId" />
    <AvatarFallback class="rounded-sm bg-transparent p-0">
      <AppIcon name="server" class="size-3.5 text-muted-foreground" />
    </AvatarFallback>
  </Avatar>
</template>
