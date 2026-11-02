<script setup lang="ts">
import { computed } from 'vue'
import { Circle } from '@lucide/vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import useSshSession from '@/composables/use-ssh-session'
import { parseSshRunsAsLine, RUNS_ON_THIS_MAC } from '@/utils/ssh-project-root'

const props = defineProps<{
  runsAt: string
}>()

const ssh = useSshSession()
const remote = computed(() => parseSshRunsAsLine(props.runsAt))
const connected = computed(() => {
  const parsed = remote.value
  if (!parsed) {
    return false
  }
  return ssh.sessions.value.some(
    (session) =>
      session.user === parsed.user &&
      session.hostname === parsed.hostname &&
      session.masterAlive &&
      session.state === 'connected',
  )
})
const tooltip = computed(() => (connected.value ? 'connected' : 'offline'))
</script>

<template>
  <span
    v-if="runsAt === RUNS_ON_THIS_MAC"
    class="shrink-0 text-xs text-muted-foreground"
  >
    {{ runsAt }}
  </span>
  <TooltipProvider v-else-if="remote">
    <Tooltip>
      <TooltipTrigger as-child>
        <span
          class="inline-flex size-3.5 shrink-0 items-center justify-center"
          :class="connected
            ? 'text-green-600 dark:text-green-400'
            : 'text-red-600 dark:text-red-400'"
          :aria-label="tooltip"
          @click.stop
        >
          <Circle class="size-2.5 fill-current" />
        </span>
      </TooltipTrigger>
      <TooltipContent class="z-60">{{ tooltip }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <span v-else class="shrink-0 text-xs text-muted-foreground">{{ runsAt }}</span>
</template>
