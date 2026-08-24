<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  CircleAlert,
  CircleCheck,
  Database,
  Loader2,
  RefreshCw,
} from '@lucide/vue'
import ProjectCodegraphNeighborhoodExplorer from '@/components/project/codegraph/NeighborhoodExplorer.vue'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import useCodegraphStatus from '@/composables/use-codegraph-status'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { isTauri, codegraphCli } from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'
import lspServerIconName from '@/utils/lsp-server-icon-name'

defineProps<{
  projectSlug?: string
}>()

const fleet = useFleetRegistry()
const codegraph = useCodegraphStatus()

const rebuilding = ref(false)

const projectRoot = computed(() => fleet.activeProject.value?.rootPath ?? null)

const statusLabel = computed(() => {
  if (rebuilding.value) {
    return 'Rebuilding'
  }
  return codegraph.label.value
})

const statusTooltip = computed(() => {
  if (rebuilding.value) {
    return 'Rebuilding index'
  }
  if (codegraph.errorMessage.value) {
    return codegraph.errorMessage.value
  }
  const detail = codegraph.detail.value
  if (
    detail &&
    (codegraph.state.value === 'indexing' || codegraph.state.value === 'syncing')
  ) {
    return detail
  }
  return statusLabel.value
})

const statusClass = computed((): string => {
  if (rebuilding.value || codegraph.isBusy.value) {
    return 'text-amber-600 dark:text-amber-400'
  }
  switch (codegraph.state.value) {
    case 'ready':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'error':
      return 'text-destructive'
    case 'indexing':
    case 'syncing':
      return 'text-amber-600 dark:text-amber-400'
    case 'idle':
    default:
      return 'text-muted-foreground'
  }
})

const statusStats = computed(() => {
  const result = codegraph.statusResult.value
  if (!result) {
    return [] as { label: string; value: string }[]
  }
  const stats: { label: string; value: string }[] = []
  if (typeof result.filesIndexed === 'number') {
    stats.push({ label: 'Files', value: String(result.filesIndexed) })
  }
  if (typeof result.totalNodes === 'number') {
    stats.push({ label: 'Nodes', value: String(result.totalNodes) })
  }
  if (typeof result.totalEdges === 'number') {
    stats.push({ label: 'Edges', value: String(result.totalEdges) })
  }
  if (result.databaseSize) {
    stats.push({ label: 'Size', value: result.databaseSize })
  }
  return stats
})

const languages = computed(() => codegraph.statusResult.value?.languages ?? [])

const languageIconName = (language: string): string =>
  lspServerIconName(language.trim().toLowerCase(), [])

const hasStats = computed(
  () => statusStats.value.length > 0 || languages.value.length > 0,
)

const handleRebuild = async (): Promise<void> => {
  const root = projectRoot.value
  if (!root || !isTauri()) {
    toast.error('Open a project to rebuild the graph')
    return
  }
  rebuilding.value = true
  try {
    await codegraphCli(root, 'index')
    await codegraph.refresh()
    toast.success('Graph index rebuilt')
  } catch (error) {
    toast.error('Failed to rebuild graph', {
      description: invokeErrorMessage(error),
    })
  } finally {
    rebuilding.value = false
  }
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
    <div class="flex shrink-0 items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-2">
        <h2 class="text-lg font-medium">Graph</h2>
        <Tooltip>
          <TooltipTrigger as-child>
            <span
              class="inline-flex size-5 shrink-0 items-center justify-center"
              :class="statusClass"
              :aria-label="`Graph status: ${statusLabel}`"
            >
              <Loader2
                v-if="rebuilding || codegraph.isBusy.value"
                class="size-4 animate-spin"
                aria-hidden="true"
              />
              <CircleAlert
                v-else-if="codegraph.state.value === 'error'"
                class="size-4"
                aria-hidden="true"
              />
              <CircleCheck
                v-else-if="codegraph.state.value === 'ready'"
                class="size-4"
                aria-hidden="true"
              />
              <Database
                v-else
                class="size-4"
                aria-hidden="true"
              />
            </span>
          </TooltipTrigger>
          <TooltipContent>{{ statusTooltip }}</TooltipContent>
        </Tooltip>
      </div>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            size="icon"
            variant="ghost"
            class="size-8 shrink-0"
            :disabled="rebuilding || !projectRoot"
            aria-label="Rebuild graph index"
            @click="handleRebuild"
          >
            <Loader2 v-if="rebuilding" class="size-4 animate-spin" />
            <RefreshCw v-else class="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Rebuild index</TooltipContent>
      </Tooltip>
    </div>

    <div
      v-if="hasStats"
      class="flex shrink-0 flex-wrap items-end gap-x-6 gap-y-2 text-sm"
    >
      <div
        v-for="stat in statusStats"
        :key="stat.label"
        class="min-w-24"
      >
        <p class="text-xs text-muted-foreground">{{ stat.label }}</p>
        <p class="font-medium tabular-nums">{{ stat.value }}</p>
      </div>
      <div
        v-if="languages.length > 0"
        class="min-w-24"
      >
        <p class="text-xs text-muted-foreground">Languages</p>
        <div class="flex h-5 items-center gap-1.5">
          <Tooltip
            v-for="language in languages"
            :key="language"
          >
            <TooltipTrigger as-child>
              <span
                class="inline-flex size-4 shrink-0 items-center justify-center"
                :aria-label="language"
              >
                <WorkbenchFileEntryIcon :name="languageIconName(language)" />
              </span>
            </TooltipTrigger>
            <TooltipContent>{{ language }}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>

    <ProjectCodegraphNeighborhoodExplorer class="min-h-0 flex-1" />
  </div>
</template>
