<script setup lang="ts">
import { computed, onMounted, ref, toRef, watch } from 'vue'
import { FileText, Folder, MessageSquare, Plus } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/shadcn/ui/empty'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import VixlFileCreateHost from '@/components/settings/vixl-files/VixlFileCreateHost.vue'
import VixlFileListItem from '@/components/settings/vixl-files/VixlFileListItem.vue'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useStartVixlFilesChat from '@/composables/use-start-vixl-files-chat'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { SettingsTab } from '@/composables/use-vixl-config'
import {
  lastVixlFileChange,
  vixlFileChangeToken,
} from '@/composables/use-vixl-live-sync'
import type { VixlFilesKind } from '@/services/vixl/vixl-tauri'
import {
  fsMkdir,
  getVixlDir,
  listVixlFiles,
  revealInFolder,
  type ProjectFileEntry,
} from '@/services/vixl/vixl-tauri'

const props = defineProps<{
  tab: SettingsTab
  kind: VixlFilesKind
  title: string
  emptyMessage: string
  folderLabel: string
}>()

const config = useVixlConfig()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const files = ref<ProjectFileEntry[]>([])
const formOpen = ref(false)

const scope = computed<'personal' | 'project'>(() =>
  props.tab === 'personal' ? 'personal' : 'project',
)

const { handleSelectChat } = useStartVixlFilesChat({
  scope,
  kind: toRef(props, 'kind'),
})

const projectRoot = computed(() =>
  props.tab === 'project' ? (config.activeRootPath.value ?? undefined) : undefined,
)

const usesCreateMenu = computed(
  () => props.kind === 'plans' || props.kind === 'studio',
)

const NEW_ITEM_TOOLTIPS: Record<VixlFilesKind, string> = {
  plans: 'New plan',
  studio: 'New studio',
  skills: 'New skill',
  agents: 'New agent',
  rules: 'New rule',
}

const newItemTooltip = computed(() => NEW_ITEM_TOOLTIPS[props.kind] ?? 'New')

const toastLoadError = (error: unknown): void => {
  toast.error('Failed to load files', {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

const isAlreadyExistsError = (error: unknown): boolean => {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const message = raw.toLowerCase()
  return (
    message.includes('already exists') ||
    message.includes('eexist') ||
    message.includes('file exists') ||
    message.includes('os error 17') ||
    message.includes('os error 183')
  )
}

const load = async (): Promise<void> => {
  if (props.tab === 'project' && !config.activeRootPath.value) {
    files.value = []
    return
  }

  files.value = await listVixlFiles(
    props.tab === 'personal' ? 'personal' : 'project',
    props.kind,
    config.activeRootPath.value,
  )
}

const refresh = async (): Promise<void> => {
  try {
    await load()
  } catch (error) {
    toastLoadError(error)
  }
}

const revealRoot = async (): Promise<void> => {
  try {
    const dir = await getVixlDir(scope.value, config.activeRootPath.value)
    const folderPath = `${dir}/${props.folderLabel}`
    try {
      await fsMkdir({ projectRoot: dir, path: props.folderLabel })
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error
      }
    }
    await revealInFolder(folderPath)
  } catch (error) {
    toast.error('Failed to reveal folder', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
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

const openInEditor = (file: ProjectFileEntry): void => {
  const projectId = resolveProjectIdForSettings()
  if (!projectId) {
    return
  }

  const relativePath = toRelativePath(file.path)

  if (props.kind === 'plans') {
    workbench.openPlan(projectId, file.name, relativePath, file.name)
    return
  }

  if (props.kind === 'studio') {
    workbench.openStudio(
      projectId,
      file.name,
      relativePath,
      file.description ?? file.name,
    )
    return
  }

  workbench.openEditor(projectId, relativePath)
}

const handleSelectForm = (): void => {
  formOpen.value = true
}

const handleSubmitted = async (): Promise<void> => {
  await refresh()
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
  if (change?.kind !== props.kind) {
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
  <SettingsSectionScroll :title="title">
    <template #actions>
      <Tooltip v-if="usesCreateMenu" :disable-closing-trigger="true">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :aria-label="newItemTooltip"
                >
                  <Plus class="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" class="w-40">
                <DropdownMenuItem @click="handleSelectChat">
                  <MessageSquare class="mr-2 h-4 w-4" />
                  Chat
                </DropdownMenuItem>
                <DropdownMenuItem @click="handleSelectForm">
                  <FileText class="mr-2 h-4 w-4" />
                  Form
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ newItemTooltip }}</TooltipContent>
      </Tooltip>

      <Tooltip v-else>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            :aria-label="newItemTooltip"
            @click="handleSelectForm"
          >
            <Plus class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{{ newItemTooltip }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Reveal in folder"
            @click="revealRoot"
          >
            <Folder class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reveal in folder</TooltipContent>
      </Tooltip>
    </template>

    <Empty
      v-if="files.length === 0"
      class="flex-1 min-h-0 border border-border/60"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>{{ emptyMessage }}</EmptyTitle>
      </EmptyHeader>
    </Empty>

    <div v-else class="flex flex-1 min-h-0 flex-col gap-2">
      <VixlFileListItem
        v-for="file in files"
        :key="file.path"
        :file="file"
        :kind="kind"
        @open="openInEditor"
      />
    </div>

    <VixlFileCreateHost
      v-model:open="formOpen"
      :kind="kind"
      :scope="scope"
      :project-root="projectRoot"
      @submitted="handleSubmitted"
    />
  </SettingsSectionScroll>
</template>
