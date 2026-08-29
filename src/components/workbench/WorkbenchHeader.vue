<script setup lang="ts">
import { computed, ref } from 'vue'
import { Plus } from '@lucide/vue'
import {
  ChartBar,
  FileCode,
  FileText,
  GitBranch,
  Terminal,
  X,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { ScrollArea, ScrollBar } from '@/components/shadcn/ui/scroll-area'
import RightSidebarTrigger from '@/components/navigation/aside/right/RightSidebarTrigger.vue'
import WorkbenchTabMenu from '@/components/workbench/WorkbenchTabMenu.vue'
import WorkbenchTabPicker from '@/components/workbench/WorkbenchTabPicker.vue'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { WorkbenchTab, WorkbenchTabType } from '@/types/workbench/workbench-tab'
import { isHomeChatSlug } from '@/constants/home-chat'

const workbench = useWorkbenchStore()

const draggedIndex = ref<number | null>(null)

const hasTabs = computed(() => workbench.tabs.value.length > 0)
const activeTabId = computed(() => workbench.activeTabId.value)

const tabIcon = (type: WorkbenchTabType) => {
  switch (type) {
    case 'editor':
      return FileCode
    case 'terminal':
      return Terminal
    case 'agent-shell':
      return Terminal
    case 'changes':
      return GitBranch
    case 'studio':
      return ChartBar
    case 'plan':
      return FileText
    default:
      return FileCode
  }
}

const projectSlug = (projectId: string): string | null => {
  const project = workbench.getProject(projectId)
  if (!project) {
    return null
  }
  if (isHomeChatSlug(project.id)) {
    return 'Home'
  }
  return project.slug
}

const tabLabel = (tab: WorkbenchTab): string => {
  const dirty = tab.dirty ? ' *' : ''
  return `${tab.label}${dirty}`
}

const handleClose = async (event: MouseEvent, tabId: string): Promise<void> => {
  event.stopPropagation()
  await workbench.closeTab(tabId)
}

const handleMiddleClick = async (event: MouseEvent, tabId: string): Promise<void> => {
  if (event.button !== 1) {
    return
  }
  event.preventDefault()
  await workbench.closeTab(tabId)
}

const handleDragStart = (index: number): void => {
  draggedIndex.value = index
}

const handleDragOver = (event: DragEvent, index: number): void => {
  event.preventDefault()
  if (draggedIndex.value === null || draggedIndex.value === index) {
    return
  }
  workbench.reorderTabs(draggedIndex.value, index)
  draggedIndex.value = index
}

const handleDragEnd = (): void => {
  draggedIndex.value = null
}
</script>

<template>
  <div
    class="absolute inset-x-0 top-0 z-10 flex h-(--titlebar-height) items-center gap-0.5 bg-sidebar pointer-events-none"
    style="--titlebar-height: 40px"
  >
    <div class="pointer-events-auto shrink-0 pl-1">
      <WorkbenchTabPicker tooltip="Open tab">
        <Button variant="ghost" size="icon" class="h-7 w-7 shrink-0" aria-label="Open tab">
          <Plus class="h-4 w-4" />
        </Button>
      </WorkbenchTabPicker>
    </div>

    <ScrollArea
      v-if="hasTabs"
      class="pointer-events-auto h-full min-w-0 flex-1"
    >
      <div class="flex h-(--titlebar-height) items-center gap-0.5 pr-1">
        <button
          v-for="(tab, index) in workbench.tabs.value"
          :key="tab.id"
          type="button"
          draggable="true"
          class="group flex h-7 max-w-[140px] shrink-0 items-center gap-1 rounded-sm px-2 text-xs transition-colors"
          :class="
            activeTabId === tab.id
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground/50 hover:bg-accent/30 hover:text-muted-foreground/80'
          "
          @click="workbench.focusTab(tab.id)"
          @auxclick="handleMiddleClick($event, tab.id)"
          @dragstart="handleDragStart(index)"
          @dragover="handleDragOver($event, index)"
          @dragend="handleDragEnd"
        >
          <component :is="tabIcon(tab.type)" class="h-3 w-3 shrink-0" />
          <span class="truncate">{{ tabLabel(tab) }}</span>
          <span
            v-if="workbench.hasMultipleProjects.value && projectSlug(tab.projectId)"
            class="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground"
          >
            {{ projectSlug(tab.projectId) }}
          </span>
          <span
            class="ml-0.5 shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
            @click="handleClose($event, tab.id)"
          >
            <X class="h-3 w-3" />
          </span>
        </button>
        <div class="h-full min-w-0 flex-1" data-tauri-drag-region />
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>

    <div v-else class="pointer-events-auto h-full min-w-0 flex-1" data-tauri-drag-region />

    <div class="pointer-events-auto mr-3 flex shrink-0 items-center gap-0.5">
      <WorkbenchTabMenu v-if="hasTabs" />
      <RightSidebarTrigger />
    </div>
  </div>
</template>
