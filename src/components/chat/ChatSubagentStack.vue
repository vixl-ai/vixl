<script setup lang="ts">
import type { SubagentEntry } from '@/types/harness/subagent-entry'
import { SquareIcon } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

defineProps<{
  subagents: SubagentEntry[]
}>()

const emit = defineEmits<{
  open: [subagentId: string]
  stop: [subagentId: string]
}>()

const displayName = (name: string): string => {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : 'Sub-agent'
}
</script>

<template>
  <ul class="flex flex-col gap-1">
    <li v-for="subagent in subagents" :key="subagent.subagentId">
      <div class="flex w-full items-center gap-2">
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-xs text-foreground/80 text-left"
          @click="emit('open', subagent.subagentId)"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <ChatRunningDots v-if="subagent.status === 'running'" />
            <span
              v-if="subagent.status === 'running'"
              class="shimmer shimmer-duration-1000 shimmer-angle-0 min-w-0 truncate"
            >
              {{ displayName(subagent.name) }}
            </span>
            <span v-else class="min-w-0 truncate">{{ displayName(subagent.name) }}</span>
          </span>
        </button>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="size-5 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label="Stop sub agent"
              @click.stop="emit('stop', subagent.subagentId)"
            >
              <SquareIcon class="size-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Stop sub agent</TooltipContent>
        </Tooltip>
      </div>
    </li>
  </ul>
</template>
