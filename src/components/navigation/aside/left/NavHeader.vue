<script setup lang="ts">
import { AppIcon } from '@/icons'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useCommandPalette from '@/composables/use-command-palette'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import chatRouteFor from '@/utils/chat-route-for'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/shadcn/ui/sidebar'

const { push } = useRouter()
const commandPalette = useCommandPalette()
const { pinnedChats } = useFleetSidebar()

const openChat = async (projectSlug: string, chatId: string): Promise<void> => {
  try {
    await push(chatRouteFor(projectSlug, chatId))
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <SidebarMenu class="pt-8">
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="New Agent" @click="push('/')">
        <AppIcon name="bot" />
        <span>New Agent</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <SidebarMenuButton tooltip="Search" @click="commandPalette.togglePalette()">
        <AppIcon name="search" />
        <span>Search</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <SidebarMenuButton tooltip="Pinned">
            <AppIcon name="pin" />
            <span>Pinned</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent class="w-64 rounded-lg" side="bottom" align="start">
          <template v-if="pinnedChats.length > 0">
            <DropdownMenuItem
              v-for="chat in pinnedChats"
              :key="chat.chatId"
              class="flex items-center justify-between gap-2"
              @click="openChat(chat.projectSlug, chat.chatId)"
            >
              <span class="truncate">{{ chat.title }}</span>
              <span class="shrink-0 text-xs text-muted-foreground">
                {{ chat.projectLabel }}
              </span>
            </DropdownMenuItem>
          </template>
          <DropdownMenuItem v-else disabled> No pinned chats </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</template>
