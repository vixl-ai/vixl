<script setup lang="ts">
import { computed, nextTick, ref, watch, type Component } from 'vue'
import { useIntervalFn } from '@vueuse/core'
import { useRouter } from 'vue-router'
import {
  Ban,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleOff,
  Loader2,
  Pause,
  Settings,
  ShieldAlert,
  TriangleAlert,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import useFleetRegistry from '@/composables/use-fleet-registry'
import {
  formatActivityLabel,
  isTransientPhase,
  phaseLabel,
} from '@/composables/lsp-status/helpers'
import useLspStatus from '@/composables/use-lsp-status'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type {
  LspHealth,
  LspProblemItem,
  LspServerDisplayState,
} from '@/types/lsp/lsp-status'
import lspServerIconName from '@/utils/lsp-server-icon-name'

const router = useRouter()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const lsp = useLspStatus()
const open = ref(false)

const healthClass = (health: LspHealth): string => {
  switch (health) {
    case 'error':
      return 'text-destructive'
    case 'warning':
      return 'text-amber-600 dark:text-amber-400'
    case 'ok':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'busy':
      return 'text-muted-foreground'
    default:
      return 'text-muted-foreground'
  }
}

const triggerClass = computed(
  (): string => `h-6 w-6 ${healthClass(lsp.health.value)}`,
)

const errorsTooltip = computed((): string => {
  const count = lsp.errorCount.value
  if (count === 0) {
    return 'No errors'
  }
  return `${count} error${count === 1 ? '' : 's'}`
})

const warningsTooltip = computed((): string => {
  const count = lsp.warningCount.value
  if (count === 0) {
    return 'No warnings'
  }
  return `${count} warning${count === 1 ? '' : 's'}`
})

const PHASE_META: Record<
  LspServerDisplayState,
  { icon: Component; label: string; className: string }
> = {
  installing: {
    icon: Loader2,
    label: phaseLabel.installing,
    className: 'text-muted-foreground',
  },
  starting: {
    icon: Loader2,
    label: phaseLabel.starting,
    className: 'text-muted-foreground',
  },
  stopping: {
    icon: Loader2,
    label: phaseLabel.stopping,
    className: 'text-muted-foreground',
  },
  running: {
    icon: CircleCheck,
    label: phaseLabel.running,
    className: 'text-emerald-600 dark:text-emerald-400',
  },
  idle: {
    icon: Circle,
    label: phaseLabel.idle,
    className: 'text-muted-foreground',
  },
  stopped: {
    icon: Pause,
    label: phaseLabel.stopped,
    className: 'text-muted-foreground',
  },
  exited: {
    icon: CircleOff,
    label: phaseLabel.exited,
    className: 'text-muted-foreground',
  },
  error: {
    icon: CircleAlert,
    label: phaseLabel.error,
    className: 'text-destructive',
  },
  crashed: {
    icon: CircleAlert,
    label: phaseLabel.crashed,
    className: 'text-destructive',
  },
  needs_trust: {
    icon: ShieldAlert,
    label: phaseLabel.needs_trust,
    className: 'text-amber-600 dark:text-amber-400',
  },
  disabled: {
    icon: Ban,
    label: phaseLabel.disabled,
    className: 'text-muted-foreground',
  },
  missing: {
    icon: CircleOff,
    label: phaseLabel.missing,
    className: 'text-muted-foreground',
  },
}

const formatElapsed = (phaseSinceMs: number, now: number): string => {
  const secondsTotal = Math.max(0, Math.floor((now - phaseSinceMs) / 1000))
  const minutes = Math.floor(secondsTotal / 60)
  const seconds = secondsTotal % 60
  if (minutes === 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${seconds}s`
}

const nowMs = ref(Date.now())
const hasTransientVisible = computed(() =>
  lsp.visibleRows.value.some(
    (row) => isTransientPhase(row.displayState) && row.phaseSinceMs > 0,
  ),
)
const { pause, resume } = useIntervalFn(
  () => {
    nowMs.value = Date.now()
  },
  1000,
  { immediate: false, immediateCallback: true },
)
watch(
  hasTransientVisible,
  (active) => {
    if (active) {
      resume()
      return
    }
    pause()
  },
  { immediate: true },
)

const statusRows = computed(() => {
  const now = nowMs.value
  return lsp.visibleRows.value.map((row) => {
    const transient = isTransientPhase(row.displayState)
    return {
      row,
      meta: PHASE_META[row.displayState],
      spinning: transient,
      elapsed:
        transient && row.phaseSinceMs > 0
          ? formatElapsed(row.phaseSinceMs, now)
          : null,
    }
  })
})

const problemLabel = (problem: LspProblemItem): string => {
  const base = problem.path.split('/').pop() ?? problem.path
  return `${base}:${problem.line}`
}

const afterMenuClosed = async (): Promise<void> => {
  open.value = false
  await nextTick()
  await nextTick()
}

const handleOpenProblem = async (problem: LspProblemItem): Promise<void> => {
  const project = fleet.activeProject.value
  if (!project) {
    toast.error('No active project')
    return
  }
  const relative =
    lsp.fileUriToProjectPath(problem.uri, project.rootPath) ?? problem.path
  try {
    await afterMenuClosed()
    await workbench.openEditor(project.id, relative)
  } catch (error) {
    toast.error('Failed to open file', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenSettings = async (): Promise<void> => {
  try {
    await afterMenuClosed()
    await router.push({
      path: '/settings',
      query: { section: 'lsp' },
    })
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Tooltip :disable-closing-trigger="true">
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0">
        <DropdownMenu v-model:open="open">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              :class="triggerClass"
              aria-label="Language servers"
            >
              <Loader2
                v-if="lsp.health.value === 'busy'"
                class="h-3.5 w-3.5 animate-spin"
              />
              <CircleAlert
                v-else-if="lsp.health.value === 'error'"
                class="h-3.5 w-3.5"
              />
              <TriangleAlert
                v-else-if="lsp.health.value === 'warning'"
                class="h-3.5 w-3.5"
              />
              <CircleCheck
                v-else
                class="h-3.5 w-3.5"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            class="w-72"
          >
            <DropdownMenuLabel class="font-normal">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate text-sm font-medium">Language servers</span>
                <div class="flex shrink-0 items-center gap-0.5">
                  <Button
                    v-if="lsp.warningCount.value > 0"
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-amber-600 dark:text-amber-400"
                    :title="warningsTooltip"
                    :aria-label="warningsTooltip"
                  >
                    <TriangleAlert class="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    v-if="lsp.errorCount.value > 0 || lsp.hasServerErrors.value"
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-destructive"
                    :title="errorsTooltip"
                    :aria-label="errorsTooltip"
                  >
                    <CircleAlert class="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-muted-foreground"
                    title="Manage installs in Settings, Language servers"
                    aria-label="Manage installs in Settings, Language servers"
                    @click="handleOpenSettings"
                  >
                    <Settings class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <p
                v-if="lsp.installMessage.value"
                class="mt-1 truncate text-xs text-muted-foreground"
                :title="lsp.installMessage.value"
              >
                {{ lsp.installMessage.value }}
              </p>
            </DropdownMenuLabel>

            <template v-if="lsp.problems.value.length > 0">
              <DropdownMenuSeparator />
              <div class="max-h-40 overflow-y-auto">
                <button
                  v-for="problem in lsp.problems.value"
                  :key="problem.id"
                  type="button"
                  class="flex w-full flex-col gap-0.5 px-2 py-1.5 text-left hover:bg-accent/50"
                  @click="handleOpenProblem(problem)"
                >
                  <div class="flex items-center gap-1.5">
                    <CircleAlert
                      v-if="problem.severity === 'error'"
                      class="h-3 w-3 shrink-0 text-destructive"
                    />
                    <TriangleAlert
                      v-else
                      class="h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400"
                    />
                    <span class="truncate text-xs font-medium">{{ problemLabel(problem) }}</span>
                  </div>
                  <span class="truncate pl-4.5 text-[11px] text-muted-foreground">
                    {{ problem.message }}
                  </span>
                </button>
              </div>
            </template>

            <DropdownMenuSeparator />

            <div
              v-if="lsp.visibleRows.value.length === 0"
              class="px-2 py-1.5 text-xs text-muted-foreground"
            >
              No language servers active
            </div>
            <div
              v-for="item in statusRows"
              :key="item.row.id"
              class="flex flex-col gap-0.5 px-2 py-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <WorkbenchFileEntryIcon
                    :name="lspServerIconName(item.row.id, item.row.extensions)"
                    class="size-3.5"
                  />
                  <span class="truncate text-sm">{{ item.row.label }}</span>
                </div>
                <span class="inline-flex shrink-0 items-center gap-1">
                  <span
                    v-if="item.elapsed"
                    class="text-[11px] text-muted-foreground"
                  >
                    {{ item.elapsed }}
                  </span>
                  <span
                    class="inline-flex"
                    role="img"
                    :title="item.meta.label"
                    :aria-label="item.meta.label"
                  >
                    <component
                      :is="item.meta.icon"
                      class="h-3.5 w-3.5"
                      :class="[
                        item.meta.className,
                        item.spinning ? 'animate-spin' : '',
                      ]"
                    />
                  </span>
                </span>
              </div>
              <p
                v-if="item.row.message"
                class="truncate text-xs text-muted-foreground"
                :title="item.row.message"
              >
                {{ item.row.message }}
              </p>
              <p
                v-if="item.row.activity"
                class="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
              >
                <Loader2 class="h-3 w-3 shrink-0 animate-spin" />
                <span class="truncate">{{ formatActivityLabel(item.row.activity) }}</span>
              </p>
              <p
                v-if="item.row.error"
                class="truncate text-xs text-destructive"
                :title="item.row.error"
              >
                {{ item.row.error }}
              </p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-60">Language servers</TooltipContent>
  </Tooltip>
</template>
