<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  ChevronsDownUp,
  FolderPlus,
  MessageSquarePlus,
  X,
} from '@lucide/vue'
import useFleetSidebar, { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useProjectsSection from '@/composables/use-projects-section'
import useAddProject from '@/composables/use-add-project'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useChatStore from '@/composables/use-chat-store'
import useVixlConfig from '@/composables/use-vixl-config'
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
  SidebarMenuItem,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftProjectRow from '@/components/navigation/aside/left/ProjectRow.vue'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import NavigationAsideLeftProjectsSectionHeader from '@/components/navigation/aside/left/ProjectsSectionHeader.vue'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { getUserHomeDir } from '@/services/vixl/vixl-tauri'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import chatRouteFor from '@/utils/chat-route-for'

const router = useRouter()
const { refreshAll } = useFleetSidebar()
const fleet = useFleetRegistry()
const chatStore = useChatStore()
const config = useVixlConfig()
const { addingProject, addProjectFromPicker } = useAddProject()
const { expansionMode, toggleCollapseAll } = useProjectsExpansion()
const {
  searchOpen,
  searchQuery,
  searchInputEl,
  filteredActivityItems,
  closeSearch,
} = useProjectsSection()

const startingChat = ref(false)

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

const handleNewChat = async (): Promise<void> => {
  if (startingChat.value) {
    return
  }

  startingChat.value = true
  try {
    const model = resolveModelForRole('agent', config.effectiveSettings.value) ?? ''
    if (!model) {
      toast.error('Select a default model in Settings before starting a chat')
      return
    }
    const chat = await chatStore.createNewChat({
      projectSlug: HOME_CHAT_SLUG,
      projectRoot: await getUserHomeDir(),
      mode: 'agent',
      model,
    })
    await refreshFleetSidebar()
    await router.push(chatRouteFor(HOME_CHAT_SLUG, chat.id))
  } catch (error) {
    toast.error('Could not start chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    startingChat.value = false
  }
}

const handleCollapseAll = (): void => {
  toggleCollapseAll()
}
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div class="flex min-h-full flex-col">
        <SidebarGroup class="flex-1">
          <div class="sticky top-0 z-10 bg-sidebar">
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
          <SidebarMenu>
            <template
              v-for="item in filteredActivityItems"
              :key="item.kind === 'project' ? `project-${item.project.slug}` : `chat-${item.chat.id}`"
            >
              <NavigationAsideLeftProjectRow
                v-if="item.kind === 'project'"
                :project="item.project"
              />
              <SidebarMenuItem v-else>
                <NavigationAsideLeftChatListItem
                  :chat="item.chat"
                  :project-slug="HOME_CHAT_SLUG"
                />
              </SidebarMenuItem>
            </template>
          </SidebarMenu>
        </SidebarGroup>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem :disabled="addingProject" @select="handleOpenProject">
        <FolderPlus />
        Open Project
      </ContextMenuItem>
      <ContextMenuItem :disabled="startingChat" @select="handleNewChat">
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
