<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'

defineProps<{
  createDialogOpen: boolean
  createDialogMode: 'file' | 'folder'
  createName: string
  creating: boolean
  deleteTarget: { path: string; isDirectory: boolean } | null
  deleting: boolean
}>()

const emit = defineEmits<{
  'update:createDialogOpen': [open: boolean]
  'update:createName': [name: string]
  createConfirm: []
  deleteOpenChange: [open: boolean]
  deleteConfirm: []
}>()
</script>

<template>
  <Dialog
    :open="createDialogOpen"
    @update:open="emit('update:createDialogOpen', $event)"
  >
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {{ createDialogMode === 'folder' ? 'New folder' : 'New file' }}
        </DialogTitle>
        <DialogDescription>
          Enter a name for the new {{ createDialogMode === 'folder' ? 'folder' : 'file' }}.
        </DialogDescription>
      </DialogHeader>
      <Input
        :model-value="createName"
        :placeholder="createDialogMode === 'folder' ? 'folder-name' : 'file-name.ts'"
        @update:model-value="emit('update:createName', String($event))"
        @keydown.enter="emit('createConfirm')"
      />
      <DialogFooter>
        <Button
          variant="outline"
          :disabled="creating"
          @click="emit('update:createDialogOpen', false)"
        >
          Cancel
        </Button>
        <Button
          :disabled="creating || !createName.trim()"
          @click="emit('createConfirm')"
        >
          Create
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="deleteTarget !== null"
    @update:open="emit('deleteOpenChange', $event)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete {{ deleteTarget?.isDirectory ? 'folder' : 'file' }}?</AlertDialogTitle>
        <AlertDialogDescription>
          <template v-if="deleteTarget?.isDirectory">
            This will permanently delete "{{ deleteTarget.path }}" and all of its contents.
          </template>
          <template v-else>
            This will permanently delete "{{ deleteTarget?.path }}".
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="deleting">
          Cancel
        </AlertDialogCancel>
        <Button
          variant="destructive"
          :disabled="deleting"
          @click="emit('deleteConfirm')"
        >
          Delete
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
