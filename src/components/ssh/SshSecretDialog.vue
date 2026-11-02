<script setup lang="ts">
import { nextTick, watch } from 'vue'
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
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import useSshSession from '@/composables/use-ssh-session'

const ssh = useSshSession()

const preventOutside = (event: Event): void => {
  event.preventDefault()
}

const handleOpenChange = (open: boolean): void => {
  if (!open && ssh.secretEvent.value) {
    void ssh.cancelSecret()
  }
}

const showSave = computed(
  () => ssh.secretEvent.value?.saveable === true,
)

watch(
  () => ssh.secretEvent.value,
  async (event) => {
    if (!event) {
      return
    }
    await nextTick()
    const el = document.getElementById('ssh-secret-value')
    ssh.secretFocusEl.value = el
    el?.focus()
  },
)
</script>

<template>
  <Dialog :open="ssh.secretEvent.value !== null" @update:open="handleOpenChange">
    <DialogContent
      class="max-w-md"
      :show-close-button="false"
      @pointer-down-outside="preventOutside"
      @interact-outside="preventOutside"
    >
      <DialogHeader>
        <DialogTitle>{{ ssh.secretTitle.value }}</DialogTitle>
      </DialogHeader>
      <div class="space-y-3">
        <p
          v-if="ssh.banner.value"
          class="whitespace-pre-wrap rounded-md border border-border/60 bg-muted/40 p-3 text-sm"
        >
          <span class="mb-1 block font-medium">
            Message from {{ ssh.banner.value.hostname }}
          </span>
          {{ ssh.banner.value.text }}
        </p>
        <p class="text-sm text-muted-foreground">
          {{ ssh.secretBody.value }}
        </p>
        <SettingsInputPasswordInput
          id="ssh-secret-value"
          v-model="ssh.secretValue.value"
        />
        <div v-if="showSave" class="flex items-center gap-2">
          <Checkbox id="ssh-save-secret" v-model="ssh.saveSecret.value" />
          <Label for="ssh-save-secret">Save</Label>
        </div>
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" @click="ssh.cancelSecret">
          Cancel
        </Button>
        <Button type="button" @click="ssh.submitSecret">
          Continue
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
