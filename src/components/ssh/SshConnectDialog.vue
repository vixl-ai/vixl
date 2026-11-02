<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
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
  if (!open) {
    void ssh.closeConnect()
  }
}

const preventOutside = (event: Event): void => {
  event.preventDefault()
}

const statusLine = computed((): string => {
  const line = ssh.connectStatus.value
  if (ssh.connectPhase.value === 'connecting' && ssh.connectElapsed.value > 0) {
    return `${line} ${ssh.connectElapsed.value}s`
  }
  return line
})
</script>

<template>
  <Dialog :open="ssh.connectOpen.value" @update:open="handleOpenChange">
    <DialogContent
      class="max-w-md"
      :show-close-button="ssh.connectPhase.value !== 'connecting'"
      @pointer-down-outside="preventOutside"
      @interact-outside="preventOutside"
    >
      <DialogHeader>
        <DialogTitle>
          <template v-if="ssh.connectPhase.value === 'confirm'">
            Connect to {{ ssh.preview.value?.hostname ?? ssh.connectHost.value }}?
          </template>
          <template v-else-if="ssh.connectPhase.value === 'error'">
            {{ ssh.connectErrorTitle.value || 'Could not connect.' }}
          </template>
          <template v-else-if="ssh.connectPhase.value === 'pick-folder'">
            Choose a folder on {{ ssh.preview.value?.hostname ?? ssh.connectHost.value }}
          </template>
          <template v-else>
            Connect over SSH
          </template>
        </DialogTitle>
      </DialogHeader>

      <div
        v-if="ssh.banner.value"
        class="rounded-md border border-border/60 bg-muted/40 p-3 text-sm whitespace-pre-wrap"
      >
        <p class="mb-1 font-medium text-foreground">
          Message from {{ ssh.banner.value.hostname }}
        </p>
        <p class="text-muted-foreground">{{ ssh.banner.value.text }}</p>
      </div>

      <div v-if="ssh.connectPhase.value === 'form'" class="space-y-3">
        <div v-if="ssh.aliases.value.length > 0" class="space-y-1.5">
          <Label>Aliases</Label>
          <div class="flex flex-wrap gap-1">
            <Button
              v-for="alias in ssh.aliases.value"
              :key="alias"
              type="button"
              variant="outline"
              size="sm"
              class="h-7"
              @click="ssh.connectHost.value = alias"
            >
              {{ alias }}
            </Button>
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="ssh-connect-host">Host</Label>
          <Input
            id="ssh-connect-host"
            v-model="ssh.connectHost.value"
            placeholder="eva or aidanhibbard@eva.local"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="ssh-connect-user">User</Label>
            <Input id="ssh-connect-user" v-model="ssh.connectUser.value" />
          </div>
          <div class="space-y-1.5">
            <Label for="ssh-connect-port">Port</Label>
            <Input id="ssh-connect-port" v-model="ssh.connectPort.value" />
          </div>
        </div>
        <div class="space-y-1.5">
          <Label for="ssh-connect-identity">Identity file</Label>
          <Input
            id="ssh-connect-identity"
            v-model="ssh.connectIdentity.value"
            placeholder="Optional"
          />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            id="ssh-connect-password-only"
            v-model="ssh.connectPasswordOnly.value"
          />
          <Label for="ssh-connect-password-only">Password only for this attempt</Label>
        </div>
      </div>

      <p
        v-else-if="ssh.connectPhase.value === 'confirm'"
        class="text-sm text-muted-foreground"
      >
        {{ ssh.confirmBody.value }}
      </p>

      <p
        v-else-if="ssh.connectPhase.value === 'connecting'"
        class="text-sm text-muted-foreground"
      >
        {{ statusLine }}
      </p>

      <div
        v-else-if="ssh.connectPhase.value === 'error'"
        class="space-y-2 text-sm text-muted-foreground"
      >
        <p class="whitespace-pre-wrap">{{ ssh.connectErrorBody.value }}</p>
        <p
          v-if="ssh.changedKey.value && ssh.changedKey.value.body.includes('.ssh/known_hosts') && !ssh.changedKey.value.canRemove"
        >
          Vixl will not change ~/.ssh/known_hosts. Remove that line in your editor, then connect again and trust the new key.
        </p>
      </div>

      <div v-else-if="ssh.connectPhase.value === 'pick-folder'" class="space-y-3">
        <p class="truncate text-xs text-muted-foreground">{{ ssh.folderAbsolute.value }}</p>
        <p v-if="ssh.folderError.value" class="text-sm text-destructive">
          {{ ssh.folderError.value }}
        </p>
        <div class="max-h-56 overflow-y-auto rounded-md border border-border/60">
          <button
            v-if="ssh.folderRelative.value !== '.'"
            type="button"
            class="flex w-full px-3 py-1.5 text-left text-sm hover:bg-accent/50"
            @click="ssh.enterFolder(ssh.folderParent())"
          >
            ..
          </button>
          <button
            v-for="entry in ssh.folderEntries.value"
            :key="entry.path"
            type="button"
            class="flex w-full px-3 py-1.5 text-left text-sm hover:bg-accent/50"
            @click="ssh.enterFolder(entry.path)"
          >
            {{ entry.name }}
          </button>
          <p
            v-if="!ssh.folderListing.value && ssh.folderEntries.value.length === 0"
            class="px-3 py-2 text-sm text-muted-foreground"
          >
            No folders
          </p>
        </div>
      </div>

      <DialogFooter>
        <template v-if="ssh.connectPhase.value === 'form'">
          <Button type="button" variant="outline" @click="ssh.closeConnect">
            Cancel
          </Button>
          <Button type="button" @click="ssh.submitConnectForm">
            Connect
          </Button>
        </template>
        <template v-else-if="ssh.connectPhase.value === 'confirm'">
          <Button type="button" variant="outline" @click="ssh.closeConnect">
            Cancel
          </Button>
          <Button type="button" @click="ssh.confirmPreviewConnect">
            Connect
          </Button>
        </template>
        <template v-else-if="ssh.connectPhase.value === 'connecting'">
          <Button type="button" variant="outline" @click="ssh.cancelConnecting">
            Cancel
          </Button>
        </template>
        <template v-else-if="ssh.connectPhase.value === 'error'">
          <Button
            v-if="ssh.changedKey.value?.canRemove"
            type="button"
            variant="outline"
            @click="ssh.openRemoveStoredKey"
          >
            Remove Vixl's stored key
          </Button>
          <Button type="button" @click="ssh.closeConnectError">
            Close
          </Button>
        </template>
        <template v-else-if="ssh.connectPhase.value === 'pick-folder'">
          <Button type="button" variant="outline" @click="ssh.closeConnect">
            Cancel
          </Button>
          <Button
            type="button"
            :disabled="ssh.folderListing.value"
            @click="ssh.registerPickedFolder"
          >
            Open this folder
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
