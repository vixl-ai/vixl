<script setup lang="ts">
import { AppIcon } from '@/icons'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@/components/shadcn/ui/context-menu'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import useFileTreeNodeMenu from '@/composables/use-file-tree-node-menu'

const props = defineProps<{
  name: string
  path: string
  isDirectory: boolean
}>()

const {
  clipboard,
  copyRelativePath,
  copyAbsolutePath,
  copyName,
  revealInFinder,
  openInEditor,
  handleRename,
  handleDelete,
  handleCut,
  handleCopy,
  handlePaste,
  handleAddFileToChat,
  handleAddFileToNewChat,
  handleOpenInTerminal,
} = useFileTreeNodeMenu()

const handleCopyRelativePath = async (): Promise<void> => {
  await copyRelativePath(props.path)
}

const handleCopyAbsolutePath = async (): Promise<void> => {
  await copyAbsolutePath(props.path)
}

const handleCopyName = async (): Promise<void> => {
  await copyName(props.name)
}

const handleRevealInFinder = async (): Promise<void> => {
  await revealInFinder(props.path, props.isDirectory)
}

const handleOpenInEditor = (): void => {
  openInEditor(props.path)
}

const handleRenameSelect = (): void => {
  handleRename(props.path)
}

const handleDeleteSelect = (): void => {
  handleDelete(props.path, props.isDirectory)
}

const handleCutSelect = (): void => {
  handleCut(props.path)
}

const handleCopySelect = (): void => {
  handleCopy(props.path)
}

const handlePasteSelect = async (): Promise<void> => {
  await handlePaste(props.path)
}

const handleAddFileToChatSelect = (): void => {
  handleAddFileToChat(props.path)
}

const handleAddFileToNewChatSelect = async (): Promise<void> => {
  await handleAddFileToNewChat(props.path)
}

const handleOpenInTerminalSelect = async (): Promise<void> => {
  await handleOpenInTerminal(props.path, props.isDirectory)
}
</script>

<template>
  <ContextMenuContent class="w-56">
    <ContextMenuLabel class="flex items-center gap-1.5">
      <WorkbenchFileEntryIcon :name="name" :is-directory="isDirectory" />
      <span class="truncate">{{ name }}</span>
    </ContextMenuLabel>
    <ContextMenuSeparator />
    <ContextMenuItem @select="handleRenameSelect">
      <AppIcon name="pencil" />
      Rename
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem @select="handleCutSelect">
      <AppIcon name="scissors" />
      Cut
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopySelect">
      <AppIcon name="clipboard-copy" />
      Copy
    </ContextMenuItem>
    <ContextMenuItem
      v-if="isDirectory"
      :disabled="!clipboard.hasClipboard.value"
      @select="handlePasteSelect"
    >
      <AppIcon name="clipboard-paste" />
      Paste
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem v-if="!isDirectory" @select="handleAddFileToChatSelect">
      <AppIcon name="file" />
      Add file to chat
    </ContextMenuItem>
    <ContextMenuItem v-if="!isDirectory" @select="handleAddFileToNewChatSelect">
      <AppIcon name="message-square-plus" />
      Add file to new chat
    </ContextMenuItem>
    <ContextMenuItem @select="handleOpenInTerminalSelect">
      <AppIcon name="terminal" />
      Open in terminal
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem @select="handleCopyRelativePath">
      <AppIcon name="copy" />
      Copy relative path
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopyAbsolutePath">
      <AppIcon name="copy" />
      Copy path
    </ContextMenuItem>
    <ContextMenuItem @select="handleCopyName">
      <AppIcon name="copy" />
      Copy name
    </ContextMenuItem>
    <ContextMenuItem @select="handleRevealInFinder">
      <AppIcon name="folder-open" />
      Reveal in Finder
    </ContextMenuItem>
    <ContextMenuItem v-if="!isDirectory" @select="handleOpenInEditor">
      <AppIcon name="file-plus" />
      Open in editor
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem variant="destructive" @select="handleDeleteSelect">
      <AppIcon name="trash" />
      Delete
    </ContextMenuItem>
  </ContextMenuContent>
</template>
