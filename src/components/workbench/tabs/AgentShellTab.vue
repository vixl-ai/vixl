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
  TerminalTitle,
} from '@/components/ai-elements/terminal'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { Button } from '@/components/shadcn/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  agentShellRevision,
  getAgentShell,
  killAgentShell,
} from '@/services/harness/shell/registry'
import { clipTerminalOutput } from '@/utils/clip-terminal-output'
import type { AgentShellPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

const props = defineProps<{
  tab: WorkbenchTab
}>()

const { transparencyEnabled } = useTransparency()

const shellId = computed(() => (props.tab.payload as AgentShellPayload).shellId)

const shell = computed(() => {
  if (agentShellRevision.value < 0) {
    return null
  }
  const record = getAgentShell(shellId.value)
  if (!record) {
    return null
  }
  return {
    status: record.status,
    command: record.command,
    stdout: record.stdout,
    stderr: record.stderr,
  }
})

const running = computed(() => shell.value?.status === 'running')

const output = computed(() => {
  const record = shell.value
  if (!record) {
    return ''
  }
  return clipTerminalOutput(record.stdout + (record.stderr ? `\n${record.stderr}` : ''))
})

const title = computed(() => {
  const command = shell.value?.command.trim() ?? ''
  const text = command || props.tab.label
  return text.length > 60 ? `${text.slice(0, 60)}...` : text
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
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden"
    :class="transparencyEnabled ? 'bg-transparent' : 'bg-background'"
  >
    <div
      v-if="!shell"
      class="flex h-full items-center justify-center text-sm text-muted-foreground"
    >
      Shell not found
    </div>
    <Terminal
      v-else
      :output="output"
      :is-streaming="running"
      :class="['h-full min-h-0 flex-1 rounded-none border-0', transparencyEnabled ? 'bg-transparent' : '']"
    >
      <TerminalHeader>
        <TerminalTitle class="min-w-0 truncate">
          <AiElementsShimmerShimmer v-if="running" :duration="1" as="span">
            {{ title }}
          </AiElementsShimmerShimmer>
          <template v-else>{{ title }}</template>
        </TerminalTitle>
        <div class="flex shrink-0 items-center gap-1">
          <TerminalActions>
            <TerminalCopyButton />
            <Tooltip v-if="running">
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
