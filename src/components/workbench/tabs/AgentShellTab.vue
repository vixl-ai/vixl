<script setup lang="ts">
import { computed } from 'vue'
import { SquareIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@/components/ai-elements/terminal'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  agentShellRevision,
  getAgentShell,
  killAgentShell,
} from '@/services/harness/shell/registry'
import type { AgentShellPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

const props = defineProps<{
  tab: WorkbenchTab
}>()

const shellId = computed(() => (props.tab.payload as AgentShellPayload).shellId)

const shell = computed(() =>
  agentShellRevision.value >= 0 ? getAgentShell(shellId.value) : null,
)

const output = computed(() => {
  const record = shell.value
  return record ? record.stdout + (record.stderr ? `\n${record.stderr}` : '') : ''
})

const isStreaming = computed(() => shell.value?.status === 'running')

const title = computed(() => {
  const command = shell.value?.command
  if (!command) {
    return props.tab.label
  }
  return command.length > 60 ? `${command.slice(0, 60)}...` : command
})

const handleStop = async (): Promise<void> => {
  try {
    await killAgentShell(shellId.value)
  } catch (error) {
    toast.error('Failed to stop terminal', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background p-2">
    <div
      v-if="!shell"
      class="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      Shell not found
    </div>
    <Terminal
      v-else
      :output="output"
      :is-streaming="isStreaming"
      class="h-full min-h-0 flex-1 rounded-md"
    >
      <TerminalHeader>
        <TerminalTitle class="min-w-0 truncate">
          <AiElementsShimmerShimmer
            v-if="isStreaming"
            :duration="1"
            as="span"
          >
            {{ title }}
          </AiElementsShimmerShimmer>
          <template v-else>{{ title }}</template>
        </TerminalTitle>
        <div class="flex shrink-0 items-center gap-1">
          <TerminalStatus />
          <TerminalActions>
            <TerminalCopyButton />
            <Tooltip v-if="isStreaming">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                  aria-label="Stop terminal"
                  @click.stop="handleStop"
                >
                  <SquareIcon class="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop terminal</TooltipContent>
            </Tooltip>
          </TerminalActions>
        </div>
      </TerminalHeader>
      <TerminalContent class="max-h-none min-h-0 flex-1" />
    </Terminal>
  </div>
</template>
