<script setup lang="ts">
import { ref } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Label } from '@/components/shadcn/ui/label'
import useSshSession from '@/composables/use-ssh-session'

const ssh = useSshSession()
const alsoAdd = ref(false)

const preventOutside = (event: Event): void => {
  event.preventDefault()
}

const handleOpenChange = (open: boolean): void => {
  if (!open && ssh.confirmEvent.value) {
    alsoAdd.value = false
    void ssh.answerHostKey(false, false)
  }
}

const handleTrust = (): void => {
  const add = alsoAdd.value
  alsoAdd.value = false
  void ssh.answerHostKey(true, add)
}

const handleReject = (): void => {
  alsoAdd.value = false
  void ssh.answerHostKey(false, false)
}

const isHostKey = computed(() => {
  const prompt = ssh.confirmEvent.value?.prompt ?? ''
  return ssh.hostKeyPrompt(prompt)
})
</script>

<template>
  <Dialog :open="ssh.confirmEvent.value !== null" @update:open="handleOpenChange">
    <DialogContent
      class="max-w-md"
      :show-close-button="false"
      @open-auto-focus="preventOutside"
      @pointer-down-outside="preventOutside"
      @interact-outside="preventOutside"
      @escape-key-down="preventOutside"
    >
      <DialogHeader>
        <DialogTitle>
          <template v-if="isHostKey">
            {{ ssh.hostKeyTitle.value }}
          </template>
          <template v-else>
            Confirm this security key.
          </template>
        </DialogTitle>
      </DialogHeader>
      <div class="space-y-3 text-sm text-muted-foreground">
        <p v-if="ssh.banner.value" class="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3">
          <span class="mb-1 block font-medium text-foreground">
            Message from {{ ssh.banner.value.hostname }}
          </span>
          {{ ssh.banner.value.text }}
        </p>
        <p class="whitespace-pre-wrap">
          {{ isHostKey ? ssh.hostKeyBody.value : ssh.confirmEvent.value?.prompt }}
        </p>
        <div v-if="isHostKey" class="flex items-center gap-2">
          <Checkbox id="ssh-also-add-known-hosts" v-model="alsoAdd" />
          <Label for="ssh-also-add-known-hosts">Also add this key to ~/.ssh/known_hosts</Label>
        </div>
      </div>
      <DialogFooter>
        <Button v-if="isHostKey" type="button" variant="outline" @click="handleReject">
          Reject
        </Button>
        <Button v-else type="button" variant="outline" @click="handleReject">
          Cancel
        </Button>
        <Button v-if="isHostKey" type="button" variant="outline" @click="handleTrust">
          Trust this key
        </Button>
        <Button v-else type="button" variant="outline" @click="handleTrust">
          Continue
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
