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
import { sshIdentityExample } from '@/utils/ssh-destination'

const ssh = useSshSession()
const identityExample = sshIdentityExample()

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

const dialogTitle = computed((): string | null => {
  if (ssh.connectPhase.value === 'error') {
    return ssh.connectErrorTitle.value || 'Could not connect.'
  }
  return null
})

const creatingFolder = ref(false)
const newFolderName = ref('')

const addFolderLabel = computed((): string => {
  const count = ssh.folderSelected.value.length
  if (count > 1) {
    return `Add ${count} folders`
  }
  return 'Add folder'
})

const startCreateFolder = (): void => {
  creatingFolder.value = true
  newFolderName.value = ''
  ssh.folderError.value = ''
}

const cancelCreateFolder = (): void => {
  creatingFolder.value = false
  newFolderName.value = ''
}

const submitNewFolder = async (): Promise<void> => {
  await ssh.createRemoteFolder(newFolderName.value)
  if (!ssh.folderError.value) {
    creatingFolder.value = false
    newFolderName.value = ''
  }
}

const folderChecked = (name: string): boolean =>
  ssh.folderSelected.value.includes(ssh.folderChildPath(name))

const onFolderChecked = (name: string, checked: boolean | 'indeterminate'): void => {
  ssh.setFolderSelected(ssh.folderChildPath(name), checked === true)
}
</script>

<template>
  <Dialog :open="ssh.connectOpen.value" @update:open="handleOpenChange">
    <DialogContent
      class="max-w-md min-w-0 overflow-x-hidden"
      :show-close-button="ssh.connectPhase.value !== 'connecting'"
      @pointer-down-outside="preventOutside"
      @interact-outside="preventOutside"
    >
      <DialogHeader v-if="dialogTitle" class="min-w-0 pr-8 text-left">
        <DialogTitle class="text-left leading-snug break-words [overflow-wrap:anywhere]">
          {{ dialogTitle }}
        </DialogTitle>
      </DialogHeader>
      <DialogTitle v-else class="sr-only">
        {{ ssh.connectPhase.value === 'pick-folder' ? 'Choose a folder' : 'SSH connection' }}
      </DialogTitle>

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
            placeholder="johnny@appleseed.example"
          />
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <Label for="ssh-connect-user">User</Label>
            <Input id="ssh-connect-user" v-model="ssh.connectUser.value" placeholder="johnny" />
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
            :placeholder="identityExample"
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
        v-else-if="ssh.connectPhase.value === 'connecting'"
        class="text-sm text-muted-foreground"
      >
        {{ statusLine }}
      </p>

      <div
        v-else-if="ssh.connectPhase.value === 'error'"
        class="min-w-0 space-y-2 text-sm text-muted-foreground"
      >
        <p class="break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ ssh.connectErrorBody.value }}
        </p>
        <p
          v-if="ssh.changedKey.value && ssh.changedKey.value.body.includes('.ssh/known_hosts') && !ssh.changedKey.value.canRemove"
        >
          Vixl will not change ~/.ssh/known_hosts. Remove that line in your editor, then connect again and trust the new key.
        </p>
      </div>

      <div v-else-if="ssh.connectPhase.value === 'pick-folder'" class="space-y-3">
        <div class="flex flex-wrap items-center gap-1 pr-6 text-sm">
          <template
            v-for="(crumb, index) in ssh.folderCrumbs.value"
            :key="crumb.path"
          >
            <span v-if="index > 0" class="text-muted-foreground">/</span>
            <button
              type="button"
              class="rounded-md bg-muted px-2 py-0.5 hover:bg-accent disabled:pointer-events-none disabled:opacity-60"
              :disabled="ssh.folderListing.value || index === ssh.folderCrumbs.value.length - 1"
              @click="ssh.enterFolder(crumb.path)"
            >
              {{ crumb.label }}
            </button>
          </template>
        </div>
        <p v-if="ssh.folderError.value" class="text-sm text-destructive">
          {{ ssh.folderError.value }}
        </p>
        <div class="max-h-56 overflow-y-auto rounded-md border border-border/60">
          <div
            v-for="entry in ssh.folderEntries.value"
            :key="entry.name"
            class="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent/50"
            :class="folderChecked(entry.name) ? 'bg-accent/40' : ''"
          >
            <Checkbox
              :model-value="folderChecked(entry.name)"
              :disabled="ssh.folderListing.value"
              :aria-label="`Select ${entry.name}`"
              @click.stop
              @update:model-value="onFolderChecked(entry.name, $event)"
            />
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left"
              :disabled="ssh.folderListing.value"
              @click="ssh.enterFolder(ssh.folderChildPath(entry.name))"
            >
              {{ entry.name }}
            </button>
          </div>
          <p
            v-if="!ssh.folderListing.value && ssh.folderEntries.value.length === 0"
            class="px-3 py-2 text-sm text-muted-foreground"
          >
            No folders
          </p>
        </div>
        <div v-if="creatingFolder" class="flex gap-2">
          <Input
            v-model="newFolderName"
            placeholder="Folder name"
            @keydown.enter.prevent="submitNewFolder"
          />
          <Button type="button" :disabled="ssh.folderListing.value" @click="submitNewFolder">
            Create
          </Button>
          <Button type="button" variant="outline" @click="cancelCreateFolder">
            Cancel
          </Button>
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
          <Button
            v-if="!creatingFolder"
            type="button"
            variant="outline"
            class="sm:mr-auto"
            :disabled="ssh.folderListing.value"
            @click="startCreateFolder"
          >
            New folder
          </Button>
          <Button type="button" variant="outline" @click="ssh.closeConnect">
            Cancel
          </Button>
          <Button
            type="button"
            :disabled="ssh.folderListing.value || ssh.folderSelected.value.length < 1"
            @click="ssh.registerPickedFolder"
          >
            {{ addFolderLabel }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
