<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, ShieldIcon, ShieldOffIcon, TerminalIcon, XIcon } from '@lucide/vue'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { toast } from 'vue-sonner'
import type { ToolRun } from '@/types/harness/tool-run'
import formatToolRunLabel from '@/utils/format-tool-run-label'
import { parseTerminalToolView, type TerminalToolPhaseView } from '@/utils/parse-terminal-tool-view'
import ChatTipIcon from '@/components/chat/ChatTipIcon.vue'
import {
  terminalPhaseStatusColorClass,
  terminalPhaseStatusKind,
  terminalPhaseStatusTooltip,
} from '@/components/chat/chat-terminal-status'
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@/components/ai-elements/terminal'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'

const props = defineProps<{
  run: ToolRun
}>()

const route = useRoute()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const open = ref(false)
const isRunning = computed(() => props.run.status === 'running')
const isError = computed(() => props.run.status === 'error')
const view = computed(() => parseTerminalToolView(props.run))
const label = computed(() => formatToolRunLabel(props.run))
const headline = computed(() => view.value?.label || label.value)
const phaseOutput = (output: string): string => {
  const command = view.value?.command
  if (!command) {
    return output
  }
  return output.length > 0 ? `$ ${command}\n${output}` : `$ ${command}`
}

const phaseStatus = (
  phase: TerminalToolPhaseView,
  phaseIndex: number,
) => {
  const isLast = phaseIndex === (view.value?.phases.length ?? 0) - 1
  const kind = terminalPhaseStatusKind({
    phase,
    isLast,
    isRunning: isRunning.value,
    isError: isError.value,
  })
  const icon =
    kind === 'ok'
      ? CheckIcon
      : kind === 'fail'
        ? XIcon
        : TerminalIcon
  return {
    icon,
    tooltip: terminalPhaseStatusTooltip(kind, phase.exitCode),
    iconClass: terminalPhaseStatusColorClass(kind),
  }
}

watch(
  [isRunning],
  ([running]) => {
    if (running) {
      open.value = true
    }
  },
  { immediate: true },
)

const handleShowTerminal = (): void => {
  const shellId = view.value?.shellId
  if (!shellId) {
    return
  }

  const slug = String(route.params.slug ?? '')
  const standalone =
    route.name === 'home-chat' || route.name === 'home-chat-subagent' || isHomeChatSlug(slug)
  const projectId = standalone
    ? HOME_WORKSPACE_ID
    : (fleet.projects.value.find((item) => item.slug === slug)?.id ?? fleet.activeProjectId.value)

  if (!projectId) {
    toast.error('Project not found', {
      description: 'Could not resolve the active project for this chat.',
    })
    return
  }

  try {
    workbench.openAgentShell(projectId, shellId)
  } catch (error) {
    toast.error('Failed to open terminal', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Collapsible v-if="view" v-model:open="open" class="w-full min-w-0 max-w-full">
    <div v-if="!open" class="flex w-full min-w-0 max-w-full items-center gap-2">
      <CollapsibleTrigger
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-sm transition-colors hover:text-foreground"
        :class="isError ? 'text-destructive/90' : 'text-muted-foreground'"
      >
        <ChevronRightIcon class="size-3.5 shrink-0" />
        <span class="min-w-0 truncate text-xs">
          <AiElementsShimmerShimmer
            v-if="isRunning"
            :duration="1"
            as="span"
          >
            {{ headline }}
          </AiElementsShimmerShimmer>
          <template v-else>{{ headline }}</template>
        </span>
      </CollapsibleTrigger>
      <div class="flex shrink-0 items-center gap-0">
        <template v-for="(phase, phaseIndex) in view.phases" :key="`${phase.title}-${phaseIndex}`">
          <ChatTipIcon
            :icon="phaseStatus(phase, phaseIndex).icon"
            :tooltip="phaseStatus(phase, phaseIndex).tooltip"
            :icon-class="`size-3.5 ${phaseStatus(phase, phaseIndex).iconClass}`"
          />
          <ChatTipIcon
            v-if="phase.badge === 'sandboxed'"
            :icon="ShieldIcon"
            tooltip="Sandboxed"
            icon-class="size-3.5 text-sky-400"
          />
          <ChatTipIcon
            v-else-if="phase.badge === 'unsandboxed'"
            :icon="ShieldOffIcon"
            tooltip="Unsandboxed"
            icon-class="size-3.5 text-red-400"
          />
        </template>
      </div>
    </div>
    <CollapsibleContent
      class="space-y-2 text-xs text-muted-foreground"
      :class="open ? '' : 'mt-1 border-l border-border/60 pl-5'"
    >
      <div class="space-y-2">
        <Terminal
          v-for="(phase, phaseIndex) in view.phases"
          :key="`${phase.title}-${phaseIndex}`"
          :output="phaseOutput(phase.output)"
          :is-streaming="isRunning && phaseIndex === view.phases.length - 1"
          class="rounded-md"
        >
          <TerminalHeader class="px-3 py-1.5">
            <CollapsibleTrigger as-child>
              <TerminalTitle class="min-w-0 cursor-pointer truncate text-xs">
                <template #icon>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger as-child>
                        <span
                          class="inline-flex size-4 shrink-0 items-center justify-center"
                          tabindex="0"
                          :aria-label="phaseStatus(phase, phaseIndex).tooltip"
                        >
                          <component
                            :is="phaseStatus(phase, phaseIndex).icon"
                            :class="`size-4 ${phaseStatus(phase, phaseIndex).iconClass}`"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent class="z-60">
                        {{ phaseStatus(phase, phaseIndex).tooltip }}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </template>
                <AiElementsShimmerShimmer
                  v-if="isRunning"
                  :duration="1"
                  as="span"
                >
                  {{ headline }}
                </AiElementsShimmerShimmer>
                <template v-else>{{ headline }}</template>
              </TerminalTitle>
            </CollapsibleTrigger>
            <div class="flex shrink-0 items-center">
              <TerminalStatus />
              <TerminalActions class="gap-0">
                <ChatTipIcon
                  v-if="phase.badge === 'sandboxed'"
                  tone="terminal"
                  :icon="ShieldIcon"
                  tooltip="Sandboxed"
                  icon-class="size-3.5 text-sky-400"
                />
                <ChatTipIcon
                  v-else-if="phase.badge === 'unsandboxed'"
                  tone="terminal"
                  :icon="ShieldOffIcon"
                  tooltip="Unsandboxed"
                  icon-class="size-3.5 text-red-400"
                />
                <TerminalCopyButton />
                <TooltipProvider v-if="view.shellId">
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        class="size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                        aria-label="Show terminal"
                        @click.stop="handleShowTerminal"
                      >
                        <ExternalLinkIcon class="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent class="z-60">Show terminal</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </TerminalActions>
            </div>
          </TerminalHeader>
          <TerminalContent class="max-h-40 p-3 text-xs" />
        </Terminal>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
