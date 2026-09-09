<script setup lang="ts">
import { AppIcon, type AppIconName } from '@/icons'
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useLspStatus from '@/composables/use-lsp-status'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { LspHealth, LspProblemItem, LspServerDisplayState } from '@/types/lsp/lsp-status'
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

const triggerClass = computed((): string => `h-6 w-6 ${healthClass(lsp.health.value)}`)

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

const stateMeta = (
  state: LspServerDisplayState,
): { icon: AppIconName; label: string; className: string } => {
  switch (state) {
    case 'installing':
      return {
        icon: 'loader',
        label: 'Installing',
        className: 'text-muted-foreground animate-spin',
      }
    case 'starting':
      return {
        icon: 'loader',
        label: 'Starting',
        className: 'text-muted-foreground animate-spin',
      }
    case 'running':
      return {
        icon: 'circle-check',
        label: 'Running',
        className: 'text-emerald-600 dark:text-emerald-400',
      }
    case 'stopped':
      return {
        icon: 'pause',
        label: 'Stopped',
        className: 'text-muted-foreground',
      }
    case 'error':
      return {
        icon: 'circle-alert',
        label: 'Error',
        className: 'text-destructive',
      }
    case 'needs_trust':
      return {
        icon: 'shield-alert',
        label: 'Needs trust',
        className: 'text-amber-600 dark:text-amber-400',
      }
    case 'disabled':
      return {
        icon: 'ban',
        label: 'Disabled',
        className: 'text-muted-foreground',
      }
    case 'missing':
      return {
        icon: 'circle-off',
        label: 'Not installed',
        className: 'text-muted-foreground',
      }
    default:
      return {
        icon: 'circle-off',
        label: 'Unknown',
        className: 'text-muted-foreground',
      }
  }
}

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
  const relative = lsp.fileUriToProjectPath(problem.uri, project.rootPath) ?? problem.path
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
            <Button variant="ghost" size="icon" :class="triggerClass" aria-label="Language servers">
              <AppIcon
                name="loader"
                v-if="lsp.health.value === 'busy'"
                class="h-3.5 w-3.5 animate-spin"
              />
              <AppIcon
                name="circle-alert"
                v-else-if="lsp.health.value === 'error'"
                class="h-3.5 w-3.5"
              />
              <AppIcon
                name="triangle-alert"
                v-else-if="lsp.health.value === 'warning'"
                class="h-3.5 w-3.5"
              />
              <AppIcon name="circle-check" v-else class="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-72">
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
                    <AppIcon name="triangle-alert" class="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    v-if="lsp.errorCount.value > 0 || lsp.hasServerErrors.value"
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-destructive"
                    :title="errorsTooltip"
                    :aria-label="errorsTooltip"
                  >
                    <AppIcon name="circle-alert" class="h-3.5 w-3.5" />
                  </Button>

                  <Button
                    variant="ghost"
                    size="icon"
                    class="h-6 w-6 text-muted-foreground"
                    title="Manage installs in Settings, Language servers"
                    aria-label="Manage installs in Settings, Language servers"
                    @click="handleOpenSettings"
                  >
                    <AppIcon name="settings" class="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
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
                    <AppIcon
                      name="circle-alert"
                      v-if="problem.severity === 'error'"
                      class="h-3 w-3 shrink-0 text-destructive"
                    />
                    <AppIcon
                      name="triangle-alert"
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
              v-for="row in lsp.visibleRows.value"
              :key="row.id"
              class="flex flex-col gap-0.5 px-2 py-1.5"
            >
              <div class="flex items-center justify-between gap-2">
                <div class="flex min-w-0 items-center gap-1.5">
                  <WorkbenchFileEntryIcon
                    :name="lspServerIconName(row.id, row.extensions)"
                    class="size-3.5"
                  />
                  <span class="truncate text-sm">{{ row.label }}</span>
                </div>
                <span
                  class="inline-flex shrink-0"
                  :title="stateMeta(row.displayState).label"
                  :aria-label="stateMeta(row.displayState).label"
                >
                  <component
                    :is="stateMeta(row.displayState).icon"
                    class="h-3.5 w-3.5"
                    :class="stateMeta(row.displayState).className"
                  />
                </span>
              </div>
              <p v-if="row.error" class="truncate text-xs text-destructive">
                {{ row.error }}
              </p>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-60">Language servers</TooltipContent>
  </Tooltip>
</template>
