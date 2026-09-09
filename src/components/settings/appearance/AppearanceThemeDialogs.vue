<script setup lang="ts">
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'

defineProps<{
  themeName: string
  renameOpen: boolean
  renameValue: string
  deleteOpen: boolean
  cancelOpen: boolean
}>()

const emit = defineEmits<{
  'update:renameOpen': [open: boolean]
  'update:renameValue': [value: string]
  'update:deleteOpen': [open: boolean]
  'update:cancelOpen': [open: boolean]
  'confirm-rename': []
  'confirm-delete': []
  discard: []
}>()
</script>

<template>
  <!-- Rename dialog -->
  <Dialog
    :open="renameOpen"
    @update:open="(open: boolean) => emit('update:renameOpen', open)"
  >
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Rename theme</DialogTitle>
      </DialogHeader>
      <div class="space-y-2">
        <Label for="appearance-rename-input">Theme name</Label>
        <Input
          id="appearance-rename-input"
          :model-value="renameValue"
          maxlength="64"
          @update:model-value="(value: string | number) => emit('update:renameValue', String(value))"
          @keyup.enter="emit('confirm-rename')"
        />
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          @click="emit('update:renameOpen', false)"
        >
          Cancel
        </Button>
        <Button @click="emit('confirm-rename')">Rename</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <!-- Delete confirmation -->
  <AlertDialog
    :open="deleteOpen"
    @update:open="(open: boolean) => emit('update:deleteOpen', open)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Delete theme?</AlertDialogTitle>
        <AlertDialogDescription>
          “{{ themeName }}” will be removed. If it is active, the app falls
          back to the Vixl Default theme. This cannot be undone.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep theme</AlertDialogCancel>
        <AlertDialogAction
          class="bg-destructive text-white hover:bg-destructive/90"
          @click="emit('confirm-delete')"
        >
          Delete
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- Cancel confirmation when dirty -->
  <AlertDialog
    :open="cancelOpen"
    @update:open="(open: boolean) => emit('update:cancelOpen', open)"
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Discard changes?</AlertDialogTitle>
        <AlertDialogDescription>
          You have unsaved changes to this theme. Discarding keeps the
          currently saved version.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Keep editing</AlertDialogCancel>
        <AlertDialogAction @click="emit('discard')">Discard</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
