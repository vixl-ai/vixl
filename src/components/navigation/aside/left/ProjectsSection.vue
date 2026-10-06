<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  ChevronsDownUp,
  FolderPlus,
  MessageSquarePlus,
  X,
} from '@lucide/vue'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useProjectsSection from '@/composables/use-projects-section'
import useAddProject from '@/composables/use-add-project'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useStartHomeChat from '@/composables/use-start-home-chat'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { Input } from '@/components/shadcn/ui/input'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/shadcn/ui/context-menu'
import {
  SidebarGroup,
  SidebarMenu,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftProjectRow from '@/components/navigation/aside/left/ProjectRow.vue'
import NavigationAsideLeftHomeFolderRow from '@/components/navigation/aside/left/HomeFolderRow.vue'
import NavigationAsideLeftProjectsSectionHeader from '@/components/navigation/aside/left/ProjectsSectionHeader.vue'

const { refreshAll } = useFleetSidebar()
const fleet = useFleetRegistry()
const { addingProject, addProjectFromPicker } = useAddProject()
const { expansionMode, toggleCollapseAll } = useProjectsExpansion()
const { startingChat, startHomeChat } = useStartHomeChat()
const {
  searchOpen,
  searchQuery,
  searchInputEl,
  filteredActivityItems,
  closeSearch,
} = useProjectsSection()

onMounted(() => {
  refreshAll().catch((error) => {
    toast.error('Failed to load projects', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
})

watch(
  () => fleet.loaded.value,
  (loaded) => {
    if (loaded) {
      refreshAll().catch((error) => {
        toast.error('Failed to load projects', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
  },
  { immediate: true },
)

const handleOpenProject = async (): Promise<void> => {
  await addProjectFromPicker()
}

const handleCollapseAll = (): void => {
  toggleCollapseAll()
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div class="flex h-full min-h-0 flex-col">
        <SidebarGroup class="flex-1 min-h-0">
          <div class="shrink-0">
            <NavigationAsideLeftProjectsSectionHeader />
            <div
              v-if="searchOpen"
              class="flex items-center gap-1 px-2 pb-1"
            >
              <Input
                ref="searchInputEl"
                v-model="searchQuery"
                type="search"
                placeholder="Filter projects and chats…"
                class="h-7 flex-1 text-xs"
              />
              <Tooltip>
                <TooltipTrigger as-child>
                  <Button
                    variant="ghost"
                    size="icon"
                    class="size-6 shrink-0"
                    aria-label="Close search"
                    @click="closeSearch"
                  >
                    <X class="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Close search</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <div class="flex-1 min-h-0 overflow-auto">
            <SidebarMenu>
              <template
                v-for="item in filteredActivityItems"
                :key="item.kind === 'project' ? `project-${item.project.slug}` : 'home'"
              >
                <NavigationAsideLeftProjectRow
                  v-if="item.kind === 'project'"
                  :project="item.project"
                />
                <NavigationAsideLeftHomeFolderRow
                  v-else
                  :chats="item.chats"
                />
              </template>
            </SidebarMenu>
          </div>
        </SidebarGroup>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem :disabled="addingProject" @select="handleOpenProject">
        <FolderPlus />
        Open Project
      </ContextMenuItem>
      <ContextMenuItem :disabled="startingChat" @select="startHomeChat">
        <MessageSquarePlus />
        New Chat
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="handleCollapseAll">
        <ChevronsDownUp />
        {{ expansionMode === 'all-collapsed' ? 'Expand All' : 'Collapse All' }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
</template>
