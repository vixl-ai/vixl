<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { Folder, FolderOpen, FolderCog, PanelLeftClose, Plus, FileCode, Terminal } from '@lucide/vue'
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
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useVixlConfig from '@/composables/use-vixl-config'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import projectRouteFor from '@/utils/project-route-for'

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

  const fleetProject = fleet.projects.value.find(
    (item) => item.slug === props.project.slug,
  )
  if (!fleetProject) {
    toast.error('Project not found')
    return
  }

  startingChat.value = true
  try {
    await fleet.setActiveProject(fleetProject.id)
    const defaultMode = 'agent' as const
    const model = resolveModelForRole(defaultMode, config.effectiveSettings.value) ?? ''
    if (!model) {
      toast.error('Select a default model in Settings before starting a chat')
      return
    }
    const chat = await chatStore.createNewChat({
      projectSlug: fleetProject.slug,
      projectRoot: fleetProject.rootPath,
      mode: defaultMode,
      model,
    })
    await refreshFleetSidebar()
    await router.push(`/project/${fleetProject.slug}/chat/${chat.id}`)
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

  const fleetProject = fleet.projects.value.find(
    (item) => item.slug === props.project.slug,
  )
  if (!fleetProject) {
    return
  }

  removingProject.value = true
  try {
    await fleet.removeProject(fleetProject.id)
    await refreshFleetSidebar()
    if (route.params.slug === props.project.slug) {
      await router.push('/')
    }
    toast.success('Project removed from sidebar')
  } catch (error) {
    toast.error('Could not remove project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    removingProject.value = false
  }
}

const handleOpenProject = async (): Promise<void> => {
  const fleetProject = fleet.projects.value.find(
    (item) => item.slug === props.project.slug,
  )
  if (!fleetProject) {
    toast.error('Project not found')
    return
  }

  try {
    await router.push(projectRouteFor(fleetProject.slug))
  } catch (error) {
    toast.error('Could not open project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenEditor = async (): Promise<void> => {
  const fleetProject = fleet.projects.value.find(
    (item) => item.slug === props.project.slug,
  )
  if (!fleetProject) {
    toast.error('Project not found')
    return
  }

  try {
    await fleet.setActiveProject(fleetProject.id)
    await workbench.openEditor(fleetProject.id, 'README.md')
  } catch (error) {
    toast.error('Could not open editor', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenTerminal = async (): Promise<void> => {
  const fleetProject = fleet.projects.value.find(
    (item) => item.slug === props.project.slug,
  )
  if (!fleetProject) {
    toast.error('Project not found')
    return
  }

  try {
    await fleet.setActiveProject(fleetProject.id)
    await workbench.openTerminal(fleetProject.id)
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
              <span class="relative inline-flex size-4 shrink-0">
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
              class="size-6"
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
        <div class="min-w-0 max-h-42 scroll-fade-b scrollbar-none overflow-x-hidden overflow-y-auto pl-3.5">
          <SidebarMenuSub class="mx-0 gap-0.5">
            <SidebarMenuSubItem
              v-for="chat in project.chats"
              :key="chat.id"
            >
              <NavigationAsideLeftChatListItem
                :chat="chat"
                :project-slug="project.slug"
              />
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </div>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>
