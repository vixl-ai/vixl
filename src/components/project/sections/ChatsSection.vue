<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  Circle,
  CircleAlert,
  KeyRound,
  MessageCircleQuestion,
  Pencil,
  ShieldAlert,
  Trash2,
} from '@lucide/vue'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import NavigationAsideLeftChatRunningDots from '@/components/navigation/aside/left/ChatRunningDots.vue'
import { dropAgentHarness } from '@/composables/use-agent-harness'
import useChatStore from '@/composables/use-chat-store'
import useFleetSidebar, { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { killShellsForChat } from '@/services/harness/shell/registry'
import { deleteChat, updateChatMeta } from '@/services/vixl/vixl-tauri'
import chatRouteFor from '@/utils/chat-route-for'
import projectRouteFor from '@/utils/project-route-for'

type ChatStatusKind =
  | 'running'
  | 'needs_approval'
  | 'needs_input'
  | 'needs_mcp_auth'
  | 'completed'
  | 'error'
  | 'idle'

const props = defineProps<{
  projectSlug: string
}>()

const route = useRoute()
const router = useRouter()
const fleetSidebar = useFleetSidebar()
const chatStore = useChatStore()

const renameOpen = ref(false)
const deleteOpen = ref(false)
const renameTitle = ref('')
const savingRename = ref(false)
const deleting = ref(false)
const activeChat = ref<FleetSidebarChat | null>(null)

const chats = computed((): FleetSidebarChat[] => {
  const project = fleetSidebar.sidebarProjects.value.find(
    (item) => item.slug === props.projectSlug,
  )
  return project?.chats ?? []
})

const statusFor = (
  chat: FleetSidebarChat,
): { kind: ChatStatusKind; label: string } => {
  const meta = chatStore.meta.value
  const live =
    meta && meta.id === chat.id && meta.projectSlug === props.projectSlug ? meta : null
  const status = live?.status ?? chat.status
  const attention = live?.attention ?? chat.attention ?? null

  if (status === 'running') {
    return { kind: 'running', label: 'Running' }
  }
  if (attention === 'needs_approval') {
    return { kind: 'needs_approval', label: 'Needs approval' }
  }
  if (attention === 'needs_input') {
    return { kind: 'needs_input', label: 'Needs input' }
  }
  if (attention === 'needs_mcp_auth') {
    return { kind: 'needs_mcp_auth', label: 'Needs MCP auth' }
  }
  if (attention === 'completed') {
    return { kind: 'completed', label: 'Done' }
  }
  if (attention === 'error') {
    return { kind: 'error', label: 'Error' }
  }
  return { kind: 'idle', label: 'Idle' }
}

const chatRows = computed(() =>
  chats.value.map((chat) => ({
    chat,
    status: statusFor(chat),
  })),
)

const openChat = async (chat: FleetSidebarChat): Promise<void> => {
  try {
    await router.push(chatRouteFor(props.projectSlug, chat.id))
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const openRenameDialog = (chat: FleetSidebarChat): void => {
  activeChat.value = chat
  renameTitle.value = chat.title
  renameOpen.value = true
}

const openDeleteDialog = (chat: FleetSidebarChat): void => {
  activeChat.value = chat
  deleteOpen.value = true
}

const handleRename = async (): Promise<void> => {
  const chat = activeChat.value
  if (!chat) {
    return
  }

  const title = renameTitle.value.trim()
  if (!title || title === chat.title) {
    renameOpen.value = false
    return
  }

  savingRename.value = true
  try {
    await updateChatMeta(props.projectSlug, chat.id, { title })
    await refreshFleetSidebar()
    renameOpen.value = false
    toast.success('Chat renamed')
  } catch (error) {
    toast.error('Could not rename chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    savingRename.value = false
  }
}

const handleDelete = async (): Promise<void> => {
  const chat = activeChat.value
  if (!chat || deleting.value) {
    return
  }

  deleting.value = true
  try {
    dropAgentHarness(props.projectSlug, chat.id)
    chatStore.dropSession(props.projectSlug, chat.id)
    await killShellsForChat(chat.id)
    await deleteChat(props.projectSlug, chat.id)
    await refreshFleetSidebar()
    deleteOpen.value = false

    if (route.params.slug === props.projectSlug && route.params.chatId === chat.id) {
      await router.push(projectRouteFor(props.projectSlug, 'chats'))
    }

    toast.success('Chat deleted')
  } catch (error) {
    toast.error('Could not delete chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    deleting.value = false
  }
}

watch(renameOpen, (open) => {
  if (!open) {
    activeChat.value = null
  }
})

watch(deleteOpen, (open) => {
  if (!open && !renameOpen.value) {
    activeChat.value = null
  }
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
    <div
      v-if="chatRows.length === 0"
      class="flex flex-1 items-center justify-center rounded-lg border border-dashed border-border/50 p-8"
    >
      <p class="text-sm text-muted-foreground">No chats in this project yet.</p>
    </div>

    <div
      v-else
      class="min-h-0 flex-1 overflow-auto rounded-lg border border-border/40"
    >
      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="h-9 px-3 text-xs">Title</TableHead>
            <TableHead class="h-9 w-16 px-3 text-xs">Status</TableHead>
            <TableHead class="h-9 w-28 px-3 text-right text-xs">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="{ chat, status } in chatRows"
            :key="chat.id"
            class="cursor-pointer hover:bg-muted/30"
            @click="openChat(chat)"
          >
            <TableCell class="px-3 py-2.5 font-medium">
              {{ chat.title }}
            </TableCell>
            <TableCell class="px-3 py-2.5" @click.stop>
              <Tooltip>
                <TooltipTrigger as-child>
                  <span
                    class="inline-flex size-8 items-center justify-center"
                    :aria-label="status.label"
                  >
                    <NavigationAsideLeftChatRunningDots
                      v-if="status.kind === 'running'"
                    />
                    <ShieldAlert
                      v-else-if="status.kind === 'needs_approval'"
                      class="size-3.5 text-amber-600 dark:text-amber-400"
                    />
                    <MessageCircleQuestion
                      v-else-if="status.kind === 'needs_input'"
                      class="size-3.5 text-amber-600 dark:text-amber-400"
                    />
                    <KeyRound
                      v-else-if="status.kind === 'needs_mcp_auth'"
                      class="size-3.5 text-amber-600 dark:text-amber-400"
                    />
                    <span
                      v-else-if="status.kind === 'completed'"
                      class="size-1.5 rounded-full bg-[#D4C1EC]"
                    />
                    <CircleAlert
                      v-else-if="status.kind === 'error'"
                      class="size-3.5 text-destructive"
                    />
                    <Circle
                      v-else
                      class="size-3.5 text-muted-foreground/50"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{{ status.label }}</TooltipContent>
              </Tooltip>
            </TableCell>
            <TableCell class="px-3 py-2.5 text-right" @click.stop>
              <div class="inline-flex items-center justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="`Rename ${chat.title}`"
                      @click="openRenameDialog(chat)"
                    >
                      <Pencil class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Rename</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-destructive hover:text-destructive"
                      :aria-label="`Delete ${chat.title}`"
                      @click="openDeleteDialog(chat)"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <Dialog v-model:open="renameOpen">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
          <DialogDescription>Enter a new title for this chat.</DialogDescription>
        </DialogHeader>
        <Input
          v-model="renameTitle"
          autocomplete="off"
          @keydown.enter.prevent="handleRename"
        />
        <DialogFooter>
          <Button variant="outline" @click="renameOpen = false">Cancel</Button>
          <Button :disabled="savingRename || !renameTitle.trim()" @click="handleRename">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete chat?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes "{{ activeChat?.title }}" and its message history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive/90"
            :disabled="deleting"
            @click="handleDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
