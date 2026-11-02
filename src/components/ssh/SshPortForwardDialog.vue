<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import useSshSession from '@/composables/use-ssh-session'

const ssh = useSshSession()

const handleOpenChange = (open: boolean): void => {
  ssh.portForwardOpen.value = open
}

const hostname = computed(() => ssh.portForwardTarget.value?.hostname ?? 'host')
</script>

<template>
  <Dialog :open="ssh.portForwardOpen.value" @update:open="handleOpenChange">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Forward a port from {{ hostname }}.</DialogTitle>
      </DialogHeader>
      <div class="space-y-3">
        <div class="space-y-1.5">
          <Label for="ssh-forward-remote-host">Remote host</Label>
          <Input id="ssh-forward-remote-host" v-model="ssh.portForwardRemoteHost.value" />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="ssh-forward-remote-port">Remote port</Label>
            <Input id="ssh-forward-remote-port" v-model="ssh.portForwardRemotePort.value" />
          </div>
          <div class="space-y-1.5">
            <Label for="ssh-forward-local-port">Local port</Label>
            <Input id="ssh-forward-local-port" v-model="ssh.portForwardLocalPort.value" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="ssh-forward-bind">Local bind</Label>
          <Input id="ssh-forward-bind" v-model="ssh.portForwardBind.value" />
        </div>
        <p v-if="ssh.portForwardBind.value.trim() === '0.0.0.0'" class="text-sm text-destructive">
          0.0.0.0 is refused.
        </p>
        <p v-else-if="ssh.portForwardError.value" class="text-sm text-destructive">
          {{ ssh.portForwardError.value }}
        </p>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" @click="ssh.portForwardOpen.value = false">
          Cancel
        </Button>
        <Button
          type="button"
          :disabled="ssh.portForwardDisabled.value"
          @click="ssh.submitPortForward"
        >
          Forward
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
