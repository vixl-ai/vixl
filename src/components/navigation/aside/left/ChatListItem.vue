<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { CircleAlert, GitFork, KeyRound, MessageCircleQuestion, Pencil, Pin, PinOff, ShieldAlert, Trash2 } from '@lucide/vue'
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/shadcn/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'
import { SidebarMenuSubButton } from '@/components/shadcn/ui/sidebar'
import { dropAgentHarness } from '@/composables/use-agent-harness'
import useChatStore from '@/composables/use-chat-store'
import useFleetSidebar, { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { killShellsForChat } from '@/services/harness/shell/registry'
import {
  deleteChat,
  forkChat,
  pinChat,
  updateChatMeta,
} from '@/services/vixl/vixl-tauri'
import chatRouteFor from '@/utils/chat-route-for'

const props = defineProps<{
  chat: FleetSidebarChat
  projectSlug: string
}>()

const route = useRoute()
const router = useRouter()
const fleetSidebar = useFleetSidebar()
const chatStore = useChatStore()

const renameOpen = ref(false)
const deleteOpen = ref(false)
const renameTitle = ref(props.chat.title)
const savingRename = ref(false)
const deleting = ref(false)
const forking = ref(false)
const pinning = ref(false)

const isPinned = computed(() =>
  fleetSidebar.pinnedChats.value.some(
    (item) => item.chatId === props.chat.id && item.projectSlug === props.projectSlug,
  ),
)

const liveMeta = computed(() => {
  const meta = chatStore.meta.value
  if (!meta) {
    return null
  }
  if (meta.id !== props.chat.id || meta.projectSlug !== props.projectSlug) {
    return null
  }
  return meta
})

const displayStatus = computed(
  () => liveMeta.value?.status ?? props.chat.status,
)

const displayAttention = computed(
  () => liveMeta.value?.attention ?? props.chat.attention ?? null,
)

const statusLabel = computed((): string | null => {
  if (displayStatus.value === 'running') {
    return 'Running'
  }
  if (displayAttention.value === 'needs_approval') {
    return 'Needs approval'
  }
  if (displayAttention.value === 'needs_input') {
    return 'Needs input'
  }
  if (displayAttention.value === 'needs_mcp_auth') {
    return 'Needs MCP auth'
  }
  if (displayAttention.value === 'completed') {
    return 'Done'
  }
  if (displayAttention.value === 'error') {
    return 'Error'
  }
  return null
})

const openChat = async (): Promise<void> => {
  try {
    await router.push(chatRouteFor(props.projectSlug, props.chat.id))
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const openRenameDialog = (): void => {
  renameTitle.value = props.chat.title
  renameOpen.value = true
}

const handleRename = async (): Promise<void> => {
  const title = renameTitle.value.trim()
  if (!title || title === props.chat.title) {
    renameOpen.value = false
    return
  }

  savingRename.value = true
  try {
    await updateChatMeta(props.projectSlug, props.chat.id, { title })
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

const handleTogglePin = async (): Promise<void> => {
  if (pinning.value) {
    return
  }

  const nextPinned = !isPinned.value
  pinning.value = true
  try {
    await pinChat(props.projectSlug, props.chat.id, nextPinned)
    await refreshFleetSidebar()
    toast.success(nextPinned ? 'Chat pinned' : 'Chat unpinned')
  } catch (error) {
    toast.error(nextPinned ? 'Could not pin chat' : 'Could not unpin chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    pinning.value = false
  }
}

const handleFork = async (): Promise<void> => {
  if (forking.value) {
    return
  }

  forking.value = true
  try {
    const forked = await forkChat(props.projectSlug, props.chat.id)
    await refreshFleetSidebar()
    await router.push(chatRouteFor(props.projectSlug, forked.id))
    toast.success('Chat forked')
  } catch (error) {
    toast.error('Could not fork chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    forking.value = false
  }
}

const handleDelete = async (): Promise<void> => {
  if (deleting.value) {
    return
  }

  deleting.value = true
  try {
    dropAgentHarness(props.projectSlug, props.chat.id)
    chatStore.dropSession(props.projectSlug, props.chat.id)
    await killShellsForChat(props.chat.id)
    await deleteChat(props.projectSlug, props.chat.id)
    await refreshFleetSidebar()
    deleteOpen.value = false

    if (
      (route.params.slug === props.projectSlug ||
        (props.projectSlug === '_home_' && route.name === 'home-chat')) &&
      route.params.chatId === props.chat.id
    ) {
      await router.push('/')
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

watch(
  () => props.chat.title,
  (title) => {
    renameTitle.value = title
  },
)
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <SidebarMenuSubButton
        as="button"
        type="button"
        class="h-8 w-full min-w-0 gap-2 overflow-visible px-2"
        :title="statusLabel ?? props.chat.title"
        @click="openChat"
      >
        <Shimmer
          v-if="displayStatus === 'running'"
          as="span"
          :duration="8"
          class="block min-w-0 flex-1 truncate text-left text-sm [--color-background:var(--color-sidebar)] [--shimmer-base:linear-gradient(90deg,#b89ad4,#7eb6d9,#7ec9a0,#a894d4,#b89ad4)]"
        >
          {{ chat.title }}
        </Shimmer>
        <span
          v-else
          class="block min-w-0 flex-1 truncate text-left text-sm"
        >
          {{ chat.title }}
        </span>
        <template v-if="displayStatus !== 'running'">
          <ShieldAlert
            v-if="displayAttention === 'needs_approval'"
            class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="Needs approval"
          />
          <MessageCircleQuestion
            v-else-if="displayAttention === 'needs_input'"
            class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="Needs input"
          />
          <KeyRound
            v-else-if="displayAttention === 'needs_mcp_auth'"
            class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
            aria-label="Needs MCP auth"
          />
          <span
            v-else-if="displayAttention === 'completed'"
            class="size-1.5 shrink-0 rounded-full bg-[#D4C1EC]"
            aria-label="Done"
          />
          <CircleAlert
            v-else-if="displayAttention === 'error'"
            class="size-3.5 shrink-0 text-destructive"
            aria-label="Error"
          />
        </template>
      </SidebarMenuSubButton>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-48">
      <ContextMenuItem :disabled="savingRename" @select="openRenameDialog">
        <Pencil />
        Rename
      </ContextMenuItem>
      <ContextMenuItem :disabled="forking" @select="handleFork">
        <GitFork />
        Fork
      </ContextMenuItem>
      <ContextMenuItem :disabled="pinning" @select="handleTogglePin">
        <PinOff v-if="isPinned" />
        <Pin v-else />
        {{ isPinned ? 'Unpin' : 'Pin' }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" @select="deleteOpen = true">
        <Trash2 />
        Delete
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>

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
          This permanently deletes "{{ chat.title }}" and its message history.
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
</template>
