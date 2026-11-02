<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Folder, FolderOpen, FolderSymlink, FolderCog, PanelLeftClose, Plus, FileCode, Terminal, Unplug, Plug, Cable } from '@lucide/vue'
import useProjectRowSsh from '@/composables/use-project-row-ssh'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/shadcn/ui/context-menu'
import {
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import NavigationAsideLeftWorktreeRow from '@/components/navigation/aside/left/WorktreeRow.vue'
import NavigationAsideLeftSidebarVirtualList from '@/components/navigation/aside/left/SidebarVirtualList.vue'
import GroupStackIcon from '@/components/navigation/aside/left/GroupStackIcon.vue'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useVixlConfig from '@/composables/use-vixl-config'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import resolveProjectRowWorkspace from '@/composables/resolve-project-row-workspace'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import chatRouteFor from '@/utils/chat-route-for'
import projectRouteFor from '@/utils/project-route-for'
import buildSidebarProjectTimeline from '@/utils/sidebar-project-timeline'

const props = defineProps<{
  project: FleetSidebarProject
}>()

const route = useRoute()
const router = useRouter()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const chatStore = useChatStore()
const config = useVixlConfig()
const expansion = useProjectsExpansion()
const startingChat = ref(false)
const removingProject = ref(false)
const manualOpen = ref<boolean | null>(null)
const isGroup = computed(() => props.project.kind === 'group')
const resolveRowWorkspace = () => resolveProjectRowWorkspace(props.project, fleet)
const parentRootPath = computed(() => resolveRowWorkspace()?.projectRoot ?? null)
const {
  isSshProject,
  sshConnected,
  handleReconnect,
  handleDisconnect,
  handleForwardPort,
} = useProjectRowSsh(
  computed(() => props.project),
  isGroup,
  resolveRowWorkspace,
)
const worktrees = computed(() => props.project.worktrees ?? [])
const timeline = computed(() =>
  buildSidebarProjectTimeline(
    props.project.chats,
    parentRootPath.value ? worktrees.value : [],
  ),
)

const timelineKey = (index: number): string => {
  const item = timeline.value[index]
  if (!item) {
    return `missing:${index}`
  }
  return item.kind === 'chat'
    ? `chat:${item.chat.id}`
    : `worktree:${item.project.slug}`
}

const timelineChat = (index: number) => {
  const item = timeline.value[index]
  return item?.kind === 'chat' ? item.chat : null
}

const timelineWorktree = (index: number) => {
  const item = timeline.value[index]
  return item?.kind === 'worktree' ? item.project : null
}

const worktreeAt = (index: number): { project: FleetSidebarProject; root: string }[] => {
  const root = parentRootPath.value
  const project = timelineWorktree(index)
  if (!root || !project) {
    return []
  }
  return [{ project, root }]
}

const chatAt = (index: number) => {
  const chat = timelineChat(index)
  return chat ? [chat] : []
}

const projectOpen = computed({
  get: (): boolean =>
    expansion.resolveOpen(props.project.defaultExpanded ?? false, manualOpen.value),
  set: (open: boolean) => {
    manualOpen.value = open
    expansion.onProjectOpenChange()
  },
})

watch(
  () => props.project.defaultExpanded,
  () => {
    manualOpen.value = null
  },
)

watch(
  () => expansion.expansionMode.value,
  () => {
    manualOpen.value = null
  },
)

const handleStartChat = async (): Promise<void> => {
  if (startingChat.value) {
    return
  }

  const workspace = resolveRowWorkspace()
  if (!workspace) {
    toast.error(isGroup.value ? 'Group not found' : 'Project not found')
    return
  }

  startingChat.value = true
  try {
    await fleet.setActiveProject(workspace.activateId)
    const defaultMode = 'agent' as const
    const model = resolveModelForRole(defaultMode, config.effectiveSettings.value) ?? ''
    if (!model) {
      toast.error('Select a default model in Settings before starting a chat')
      return
    }
    const chat = await chatStore.createNewChat({
      projectSlug: workspace.slug,
      projectRoot: workspace.projectRoot,
      mode: defaultMode,
      model,
    })
    await refreshFleetSidebar()
    await router.push(chatRouteFor(workspace.slug, chat.id))
  } catch (error) {
    toast.error('Could not start chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    startingChat.value = false
  }
}

const handleRemoveFromSidebar = async (): Promise<void> => {
  if (removingProject.value) {
    return
  }

  const workspace = resolveRowWorkspace()
  if (!workspace) {
    return
  }

  removingProject.value = true
  try {
    await workspace.remove()
    await refreshFleetSidebar()
    if (route.params.slug === props.project.slug) {
      await router.push('/')
    }
    toast.success(isGroup.value ? 'Group removed from sidebar' : 'Project removed from sidebar')
  } catch (error) {
    toast.error(isGroup.value ? 'Could not remove group' : 'Could not remove project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    removingProject.value = false
  }
}

const handleOpenProject = async (): Promise<void> => {
  const workspace = resolveRowWorkspace()
  if (!workspace) {
    toast.error(isGroup.value ? 'Group not found' : 'Project not found')
    return
  }

  try {
    await router.push(projectRouteFor(workspace.slug))
  } catch (error) {
    toast.error(isGroup.value ? 'Could not open group' : 'Could not open project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenEditor = async (): Promise<void> => {
  const workspace = resolveRowWorkspace()
  if (!workspace) {
    toast.error(isGroup.value ? 'Group not found' : 'Project not found')
    return
  }

  try {
    await workbench.openEditor(workspace.activateId, 'README.md')
  } catch (error) {
    toast.error('Could not open editor', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenTerminal = async (): Promise<void> => {
  const workspace = resolveRowWorkspace()
  if (!workspace) {
    toast.error(isGroup.value ? 'Group not found' : 'Project not found')
    return
  }

  try {
    await workbench.openTerminal(workspace.activateId)
  } catch (error) {
    toast.error('Could not open terminal', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Collapsible
    v-model:open="projectOpen"
    as-child
    class="group/collapsible"
  >
    <SidebarMenuItem>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <CollapsibleTrigger as-child>
            <SidebarMenuButton :tooltip="project.displayName">
              <span v-if="isGroup" class="inline-flex size-4 shrink-0">
                <GroupStackIcon :slug="project.slug" :open="projectOpen" />
              </span>
              <Tooltip v-else-if="isSshProject">
                <TooltipTrigger as-child>
                  <span
                    class="relative inline-flex size-4 shrink-0"
                    :class="sshConnected
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-red-600 dark:text-red-400'"
                  >
                    <FolderSymlink
                      class="size-4 shrink-0 opacity-100 transition-all duration-150 group-data-[state=open]/collapsible:scale-90 group-data-[state=open]/collapsible:rotate-6 group-data-[state=open]/collapsible:opacity-0"
                    />
                    <FolderOpen
                      class="pointer-events-none absolute inset-0 size-4 shrink-0 scale-90 -rotate-6 opacity-0 transition-all duration-150 group-data-[state=open]/collapsible:scale-100 group-data-[state=open]/collapsible:rotate-0 group-data-[state=open]/collapsible:opacity-100"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">
                  {{ sshConnected ? 'connected' : 'offline' }}
                </TooltipContent>
              </Tooltip>
              <span v-else class="relative inline-flex size-4 shrink-0">
                <Folder
                  class="size-4 shrink-0 opacity-100 transition-all duration-150 group-data-[state=open]/collapsible:scale-90 group-data-[state=open]/collapsible:rotate-6 group-data-[state=open]/collapsible:opacity-0"
                />
                <FolderOpen
                  class="pointer-events-none absolute inset-0 size-4 shrink-0 scale-90 -rotate-6 opacity-0 transition-all duration-150 group-data-[state=open]/collapsible:scale-100 group-data-[state=open]/collapsible:rotate-0 group-data-[state=open]/collapsible:opacity-100"
                />
              </span>
              <span class="min-w-0 flex-1 truncate">{{ project.displayName }}</span>
            </SidebarMenuButton>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-52">
          <ContextMenuItem @select="handleOpenProject">
            <FolderCog />
            Open Project
          </ContextMenuItem>
          <ContextMenuItem @select="handleOpenEditor">
            <FileCode />
            Open Editor
          </ContextMenuItem>
          <ContextMenuItem @select="handleOpenTerminal">
            <Terminal />
            Open Terminal
          </ContextMenuItem>
          <template v-if="isSshProject">
            <ContextMenuSeparator />
            <ContextMenuItem @select="handleReconnect">
              <Plug />
              Reconnect
            </ContextMenuItem>
            <ContextMenuItem v-if="sshConnected" @select="handleDisconnect">
              <Unplug />
              Disconnect
            </ContextMenuItem>
            <ContextMenuItem @select="handleForwardPort">
              <Cable />
              Forward a port
            </ContextMenuItem>
          </template>
          <ContextMenuSeparator />
          <ContextMenuItem
            :disabled="removingProject"
            @select="handleRemoveFromSidebar"
          >
            <PanelLeftClose />
            Remove from sidebar
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <Tooltip>
        <TooltipTrigger as-child>
          <SidebarMenuAction as-child>
            <Button
              variant="ghost"
              size="icon"
              class="size-5"
              :disabled="startingChat"
              :aria-label="`New chat in ${project.displayName}`"
              @click.stop="handleStartChat"
            >
              <Plus class="size-3.5" />
            </Button>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>{{ `New chat in ${project.displayName}` }}</TooltipContent>
      </Tooltip>
      <CollapsibleContent
        class="overflow-hidden data-[state=closed]:animate-sidebar-collapsible-up data-[state=open]:animate-sidebar-collapsible-down"
      >
        <NavigationAsideLeftSidebarVirtualList
          class="pl-3.5"
          :count="timeline.length"
          :key-at="timelineKey"
        >
          <template #default="{ index }">
            <NavigationAsideLeftWorktreeRow
              v-for="row in worktreeAt(index)"
              :key="row.project.slug"
              :project="row.project"
              :parent-root-path="row.root"
            />
            <NavigationAsideLeftChatListItem
              v-for="chat in chatAt(index)"
              :key="chat.id"
              :chat="chat"
              :project-slug="project.slug"
            />
          </template>
        </NavigationAsideLeftSidebarVirtualList>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>
