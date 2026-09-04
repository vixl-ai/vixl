<script setup lang="ts">
import { FileText } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/shadcn/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import type { SettingsTab } from '@/composables/use-vixl-config'
import { writeAgentsMd } from '@/services/agents-md'
import {
  listVixlFiles,
  type ProjectFileEntry,
} from '@/services/vixl/vixl-tauri'

const props = defineProps<{
  tab: SettingsTab
}>()

const config = useVixlConfig()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const file = ref<ProjectFileEntry | null>(null)
const creating = ref(false)

const scope = computed<'personal' | 'project'>(() =>
  props.tab === 'personal' ? 'personal' : 'project',
)

const canCreate = computed(
  () =>
    !creating.value &&
    !file.value &&
    !(props.tab === 'project' && !config.activeRootPath.value),
)

const toastLoadError = (error: unknown): void => {
  toast.error('Failed to load AGENTS.md', {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

const load = async (): Promise<void> => {
  if (props.tab === 'project' && !config.activeRootPath.value) {
    file.value = null
    return
  }

  const files = await listVixlFiles(
    scope.value,
    'agents-md',
    config.activeRootPath.value,
  )
  file.value = files[0] ?? null
}

const refresh = async (): Promise<void> => {
  try {
    await load()
  } catch (error) {
    toastLoadError(error)
  }
}

const toRelativePath = (absolutePath: string): string => {
  const root = config.activeRootPath.value
  if (root && absolutePath.startsWith(root)) {
    return absolutePath.slice(root.length).replace(/^\//, '')
  }
  return absolutePath
}

const resolveProjectIdForSettings = (): string | null => {
  const root = config.activeRootPath.value
  if (props.tab === 'project' && root) {
    const match = fleet.projects.value.find((project) => project.rootPath === root)
    if (match) {
      return match.id
    }
  }
  return fleet.activeProjectId.value
}

const openInEditor = async (entry: ProjectFileEntry): Promise<void> => {
  const projectId = resolveProjectIdForSettings()
  if (!projectId) {
    return
  }

  try {
    await workbench.openEditor(projectId, toRelativePath(entry.path))
  } catch (error) {
    toast.error('Failed to open AGENTS.md', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleCreate = async (): Promise<void> => {
  if (file.value || creating.value) {
    return
  }
  if (props.tab === 'project' && !config.activeRootPath.value) {
    return
  }

  creating.value = true
  try {
    await writeAgentsMd({
      scope: scope.value,
      projectRoot:
        props.tab === 'project'
          ? (config.activeRootPath.value ?? undefined)
          : undefined,
    })
    await refresh()
    toast.success('AGENTS.md created')
  } catch (error) {
    toast.error('Failed to create AGENTS.md', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    creating.value = false
  }
}

onMounted(async () => {
  await refresh()
})

watch(
  () => [props.tab, config.activeRootPath.value] as const,
  async () => {
    await refresh()
  },
)

watch(vixlFileChangeToken, async () => {
  const change = lastVixlFileChange.value
  if (change?.kind !== 'agents-md') {
    return
  }
  if (change.scope === 'personal' && props.tab !== 'personal') {
    return
  }
  if (change.scope === 'project' && props.tab !== 'project') {
    return
  }
  await refresh()
})
</script>

<template>
  <div class="flex shrink-0 flex-col gap-2 pb-4">
    <h3 class="text-sm font-medium">AGENTS.md</h3>

    <Empty
      v-if="!file"
      class="min-h-0 flex-none border border-border/60 p-4 md:p-4"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileText />
        </EmptyMedia>
        <EmptyTitle>No AGENTS.md</EmptyTitle>
      </EmptyHeader>
      <EmptyContent>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              size="sm"
              :disabled="!canCreate"
              aria-label="New AGENTS.md"
              @click="handleCreate"
            >
              Create
            </Button>
          </TooltipTrigger>
          <TooltipContent>New AGENTS.md</TooltipContent>
        </Tooltip>
      </EmptyContent>
    </Empty>

    <VixlFileListItem
      v-else
      :file="file"
      kind="agents-md"
      @open="openInEditor"
    />
  </div>
</template>
