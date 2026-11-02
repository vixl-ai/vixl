<script setup lang="ts">
import { Pencil, Trash2 } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import { Label } from '@/components/shadcn/ui/label'
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import useSshSecretsSection from '@/composables/ssh-secrets-section'
import type { SettingsTab } from '@/composables/use-vixl-config'

defineProps<{
  tab: SettingsTab
}>()

const {
  rows,
  replaceOpen,
  replaceRow,
  replaceValue,
  replaceError,
  saving,
  hostnameFor,
  openReplace,
  saveReplace,
  removeRow,
} = useSshSecretsSection()
</script>

<template>
  <SettingsSectionScroll>
    <div
      v-if="rows.length === 0"
      class="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-4 py-12"
    >
      <p class="text-sm text-muted-foreground">No saved SSH passwords or passphrases.</p>
    </div>
    <div v-else class="space-y-2">
      <div
        v-for="row in rows"
        :key="`${row.kind}:${row.identity}`"
        class="flex flex-col gap-3 rounded-lg border border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <p class="font-medium">{{ row.label }}</p>
        <div class="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                aria-label="Replace"
                @click="openReplace(row)"
              >
                <Pencil class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Replace</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                aria-label="Delete"
                @click="removeRow(row)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Delete</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>

    <Dialog :open="replaceOpen" @update:open="replaceOpen = $event">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Replace the saved
            {{ replaceRow?.kind === 'passphrase' ? 'passphrase' : 'password' }}
            for {{ replaceRow ? hostnameFor(replaceRow) : '' }}.
          </DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          The current password is not shown. The live connection is unchanged. The next login uses this once.
        </p>
        <div class="space-y-1.5">
          <Label for="ssh-replace-secret">New value</Label>
          <SettingsInputPasswordInput id="ssh-replace-secret" v-model="replaceValue" />
        </div>
        <p v-if="replaceError" class="text-sm text-destructive">{{ replaceError }}</p>
        <DialogFooter>
          <Button type="button" variant="outline" @click="replaceOpen = false">
            Cancel
          </Button>
          <Button type="button" :disabled="saving" @click="saveReplace">
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsSectionScroll>
</template>
