<script setup lang="ts">
import type { AgentShellRecord } from '@/types/harness/agent-shell'
import { SquareIcon, TerminalIcon } from '@lucide/vue'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import {
  Queue,
  QueueItem,
  QueueItemActions,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from '@/components/ai-elements/queue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

defineProps<{
  shells: AgentShellRecord[]
}>()

const emit = defineEmits<{
  openShell: [shellId: string]
  stopShell: [shellId: string]
}>()

const truncateCommand = (command: string, max = 60): string =>
  command.length > max ? `${command.slice(0, max)}…` : command
</script>

<template>
  <Queue v-if="shells.length > 0">
    <QueueSection :default-open="true">
      <QueueSectionTrigger>
        <QueueSectionLabel
          :count="shells.length"
          label="running"
        >
          <template #icon>
            <TerminalIcon class="size-3.5" />
          </template>
        </QueueSectionLabel>
      </QueueSectionTrigger>
      <QueueSectionContent>
        <ul class="flex flex-col gap-1">
          <QueueItem
            v-for="shell in shells"
            :key="shell.shellId"
          >
            <div class="flex w-full items-center gap-2">
              <button
                type="button"
                class="min-w-0 flex-1 truncate font-mono text-xs text-foreground/80 text-left"
                @click="emit('openShell', shell.shellId)"
              >
                <AiElementsShimmerShimmer :duration="1" as="span">
                  {{ truncateCommand(shell.command) }}
                </AiElementsShimmerShimmer>
              </button>
              <QueueItemActions class="ml-auto shrink-0">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-5 shrink-0 text-muted-foreground hover:text-foreground"
                      aria-label="Stop terminal"
                      @click.stop="emit('stopShell', shell.shellId)"
                    >
                      <SquareIcon class="size-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Stop terminal</TooltipContent>
                </Tooltip>
              </QueueItemActions>
            </div>
          </QueueItem>
        </ul>
      </QueueSectionContent>
    </QueueSection>
  </Queue>
</template>
