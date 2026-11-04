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
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import NavigationAsideLeftSidebarVirtualList from '@/components/navigation/aside/left/SidebarVirtualList.vue'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useStartHomeChat from '@/composables/use-start-home-chat'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'

const props = defineProps<{
  chats: FleetSidebarChat[]
}>()

const chatKey = (index: number): string => props.chats[index]?.id ?? `missing:${index}`

const chatAt = (index: number): FleetSidebarChat[] => {
  const chat = props.chats[index]
  return chat ? [chat] : []
}

const route = useRoute()
const expansion = useProjectsExpansion()
const { startingChat, startHomeChat } = useStartHomeChat()
const defaultExpanded = computed(
  () => route.name === 'home-chat' || route.name === 'home-chat-subagent',
)
const manualOpen = ref<boolean | null>(defaultExpanded.value ? true : null)

const homeOpen = computed({
  get: (): boolean => expansion.resolveOpen(defaultExpanded.value, manualOpen.value),
  set: (open: boolean) => {
    manualOpen.value = open
    expansion.onProjectOpenChange()
  },
})

watch(defaultExpanded, (expanded, wasExpanded) => {
  if (manualOpen.value !== null) {
    return
  }
  if (expanded && !wasExpanded) {
    manualOpen.value = true
  }
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
        <NavigationAsideLeftSidebarVirtualList
          class="pl-3.5"
          :count="chats.length"
          :key-at="chatKey"
        >
          <template #default="{ index }">
            <NavigationAsideLeftChatListItem
              v-for="chat in chatAt(index)"
              :key="chat.id"
              :chat="chat"
              :project-slug="HOME_CHAT_SLUG"
            />
          </template>
        </NavigationAsideLeftSidebarVirtualList>
      </CollapsibleContent>
    </SidebarMenuItem>
  </Collapsible>
</template>
