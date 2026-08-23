<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import {
  Copy,
  Download,
  Pencil,
  Pin,
  PinOff,
} from '@lucide/vue'
import useChatStore from '@/composables/use-chat-store'
import useFleetSidebar, { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
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
import {
  pinChat,
  saveTextFileWithDialog,
  updateChatMeta,
} from '@/services/pyrola/pyrola-tauri'
import buildChatTranscript from '@/utils/build-chat-transcript'
import sanitizeExportFilename from '@/utils/sanitize-export-filename'

const props = defineProps<{
  projectSlug: string
  chatId: string
}>()

const chatStore = useChatStore()
const fleetSidebar = useFleetSidebar()

const renameOpen = ref(false)
const renameTitle = ref('')
const savingRename = ref(false)
const pinning = ref(false)
const exporting = ref(false)
const copying = ref(false)

const chatTitle = computed(() => chatStore.meta.value?.title ?? 'Chat')

const isPinned = computed(() => {
  if (chatStore.meta.value?.id === props.chatId) {
    return Boolean(chatStore.meta.value.pinned)
  }
  return fleetSidebar.pinnedChats.value.some(
    (item) => item.chatId === props.chatId && item.projectSlug === props.projectSlug,
  )
})

const hasChat = computed(() => props.chatId.length > 0)

const handleCopyId = async (): Promise<void> => {
  if (copying.value || !hasChat.value) {
    return
  }

  copying.value = true
  try {
    await navigator.clipboard.writeText(props.chatId)
    toast.success('Chat ID copied')
  } catch (error) {
    toast.error('Could not copy chat ID', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    copying.value = false
  }
}

const handleExportTranscript = async (): Promise<void> => {
  if (exporting.value || !hasChat.value) {
    return
  }

  exporting.value = true
  try {
    const transcript = buildChatTranscript(chatStore.messages.value)
    const filename = `${sanitizeExportFilename(chatTitle.value)}.txt`
    const saved = await saveTextFileWithDialog(filename, transcript)
    if (saved) {
      toast.success('Transcript exported')
    }
  } catch (error) {
    toast.error('Could not export transcript', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    exporting.value = false
  }
}

const openRenameDialog = (): void => {
  if (!hasChat.value) {
    return
  }
  renameTitle.value = chatTitle.value
  renameOpen.value = true
}

const handleRename = async (): Promise<void> => {
  const title = renameTitle.value.trim()
  if (!title || title === chatTitle.value) {
    renameOpen.value = false
    return
  }

  savingRename.value = true
  try {
    await updateChatMeta(props.projectSlug, props.chatId, { title })
    chatStore.patchMeta({ title })
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
  if (pinning.value || !hasChat.value) {
    return
  }

  const nextPinned = !isPinned.value
  pinning.value = true
  try {
    const record = await pinChat(props.projectSlug, props.chatId, nextPinned)
    chatStore.patchMeta({
      pinned: record.pinned,
      pinnedAt: record.pinnedAt,
    })
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

watch(
  chatTitle,
  (title) => {
    if (!renameOpen.value) {
      renameTitle.value = title
    }
  },
  { immediate: true },
)
</script>

<template>
  <ContextMenu>
    <ContextMenuTrigger as-child>
      <div class="relative flex h-full min-h-0 flex-col">
        <slot />
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent class="w-52">
      <ContextMenuItem :disabled="copying" @select="handleCopyId">
        <Copy />
        Copy ID
      </ContextMenuItem>
      <ContextMenuItem
        :disabled="exporting"
        @select="handleExportTranscript"
      >
        <Download />
        Export Transcript
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        :disabled="savingRename"
        @select="openRenameDialog"
      >
        <Pencil />
        Rename
      </ContextMenuItem>
      <ContextMenuItem
        :disabled="pinning"
        @select="handleTogglePin"
      >
        <PinOff v-if="isPinned" />
        <Pin v-else />
        {{ isPinned ? 'Unpin' : 'Pin' }}
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
</template>
