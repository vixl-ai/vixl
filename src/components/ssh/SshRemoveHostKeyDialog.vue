<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import useSshSession from '@/composables/use-ssh-session'

const ssh = useSshSession()

const handleOpenChange = (open: boolean): void => {
  if (!open) {
    ssh.removeKeyOpen.value = false
  }
}

const preventOutside = (event: Event): void => {
  event.preventDefault()
}
</script>

<template>
  <Dialog :open="ssh.removeKeyOpen.value" @update:open="handleOpenChange">
    <DialogContent
      class="max-w-md"
      :show-close-button="false"
      @pointer-down-outside="preventOutside"
      @interact-outside="preventOutside"
    >
      <DialogHeader>
        <DialogTitle>
          Remove the stored host key for {{ ssh.changedKey.value?.hostname }}?
        </DialogTitle>
      </DialogHeader>
      <p class="text-sm text-muted-foreground">
        This removes Vixl's line for {{ ssh.changedKey.value?.hostname }} from ~/.vixl/ssh/known_hosts.
        It does not connect, and it does not remove a line from ~/.ssh/known_hosts.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" @click="ssh.removeKeyOpen.value = false">
          Cancel
        </Button>
        <Button type="button" @click="ssh.confirmRemoveStoredKey">
          Remove stored key
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
