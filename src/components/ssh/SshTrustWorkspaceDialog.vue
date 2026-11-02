<script setup lang="ts">
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import useSshSession from '@/composables/use-ssh-session'
import useVixlConfig from '@/composables/use-vixl-config'
import { tryParseSshProjectRoot } from '@/utils/ssh-project-root'

const ssh = useSshSession()
const config = useVixlConfig()

const hostname = computed(() => {
  const parsed = tryParseSshProjectRoot(ssh.trustRoot.value ?? '')
  return parsed?.hostname ?? 'this host'
})

const handleOpenChange = (open: boolean): void => {
  ssh.trustOpen.value = open
  if (!open) {
    ssh.trustRoot.value = null
  }
}

const handleTrust = async (): Promise<void> => {
  const root = ssh.trustRoot.value
  if (!root) {
    handleOpenChange(false)
    return
  }
  const records = [...(config.effectiveSettings.value['workspace.trust'] ?? [])]
  const next = records.filter((record) => record.rootPath !== root)
  next.push({ rootPath: root, trusted: true })
  try {
    await config.updateSetting('personal', 'workspace.trust', next)
    handleOpenChange(false)
  } catch (error) {
    toast.error('Could not save workspace trust', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Dialog :open="ssh.trustOpen.value" @update:open="handleOpenChange">
    <DialogContent class="max-w-md">
      <DialogHeader>
        <DialogTitle>Trust workspace</DialogTitle>
      </DialogHeader>
      <p class="text-sm text-muted-foreground">
        Language servers for this project will run on {{ hostname }}.
      </p>
      <DialogFooter>
        <Button type="button" variant="outline" @click="handleOpenChange(false)">
          Cancel
        </Button>
        <Button type="button" @click="handleTrust">
          Trust workspace
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
