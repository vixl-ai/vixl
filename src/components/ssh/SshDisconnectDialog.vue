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
    ssh.disconnectConfirm.value = null
  }
}
</script>

<template>
  <Dialog :open="ssh.disconnectConfirm.value !== null" @update:open="handleOpenChange">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>
          Disconnect {{ ssh.disconnectConfirm.value?.hostname }}?
        </DialogTitle>
      </DialogHeader>
      <p class="text-sm text-muted-foreground">
        This also disconnects every project on
        {{ ssh.disconnectConfirm.value?.user }}@{{ ssh.disconnectConfirm.value?.hostname }}:{{ ssh.disconnectConfirm.value?.port }}.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" @click="ssh.disconnectConfirm.value = null">
          Cancel
        </Button>
        <Button type="button" @click="ssh.confirmDisconnect">
          Disconnect
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
