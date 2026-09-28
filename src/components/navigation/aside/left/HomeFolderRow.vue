<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Folder, FolderOpen, Plus } from '@lucide/vue'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
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
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useStartHomeChat from '@/composables/use-start-home-chat'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'

defineProps<{
  chats: FleetSidebarChat[]
}>()

const route = useRoute()
const expansion = useProjectsExpansion()
const { startingChat, startHomeChat } = useStartHomeChat()
const manualOpen = ref<boolean | null>(null)

const defaultExpanded = computed(
  () => route.name === 'home-chat' || route.name === 'home-chat-subagent',
)

const homeOpen = computed({
  get: (): boolean => expansion.resolveOpen(defaultExpanded.value, manualOpen.value),
  set: (open: boolean) => {
    manualOpen.value = open
    expansion.onProjectOpenChange()
  },
})

watch(defaultExpanded, () => {
  manualOpen.value = null
})

watch(
  () => expansion.expansionMode.value,
  () => {
    manualOpen.value = null
  },
)
</script>

<template>
  <Collapsible
    v-model:open="homeOpen"
    as-child
    class="group/collapsible"
  >
    <SidebarMenuItem>
      <CollapsibleTrigger as-child>
        <SidebarMenuButton tooltip="Home">
          <span class="relative inline-flex size-4 shrink-0">
            <Folder
              class="size-4 shrink-0 opacity-100 transition-all duration-150 group-data-[state=open]/collapsible:scale-90 group-data-[state=open]/collapsible:rotate-6 group-data-[state=open]/collapsible:opacity-0"
            />
            <FolderOpen
              class="pointer-events-none absolute inset-0 size-4 shrink-0 scale-90 -rotate-6 opacity-0 transition-all duration-150 group-data-[state=open]/collapsible:scale-100 group-data-[state=open]/collapsible:rotate-0 group-data-[state=open]/collapsible:opacity-100"
            />
          </span>
          <span class="min-w-0 flex-1 truncate">Home</span>
        </SidebarMenuButton>
      </CollapsibleTrigger>
      <Tooltip>
        <TooltipTrigger as-child>
          <SidebarMenuAction as-child>
            <Button
              variant="ghost"
              size="icon"
              class="size-5"
              :disabled="startingChat"
              aria-label="New home chat"
              @click.stop="startHomeChat"
            >
              <Plus class="size-3.5" />
            </Button>
          </SidebarMenuAction>
        </TooltipTrigger>
        <TooltipContent>New home chat</TooltipContent>
      </Tooltip>
      <CollapsibleContent
        class="overflow-hidden data-[state=closed]:animate-sidebar-collapsible-up data-[state=open]:animate-sidebar-collapsible-down"
      >
        <div class="min-w-0 max-h-42 scroll-fade-b scrollbar-none overflow-x-hidden overflow-y-auto pl-3.5">
          <SidebarMenuSub class="mx-0 gap-0.5">
            <SidebarMenuSubItem
              v-for="chat in chats"
              :key="chat.id"
            >
              <NavigationAsideLeftChatListItem
                :chat="chat"
                :project-slug="HOME_CHAT_SLUG"
              />
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </div>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>
