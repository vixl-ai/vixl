<script setup lang="ts">
import { computed, ref } from 'vue'
import { Keyboard, Loader2, Monitor, Moon, RefreshCw, Sun } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { Progress } from '@/components/shadcn/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import useAppUpdater from '@/composables/use-app-updater'
import useVixlConfig from '@/composables/use-vixl-config'
import { appShortcutHelp } from '@/utils/keyboard'
import formatUnknownError from '@/utils/format-unknown-error'
import type { VixlTheme } from '@/types/vixl/vixl-settings'

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

const config = useVixlConfig()
const updater = useAppUpdater()
const shortcutsOpen = ref(false)

const theme = computed(
  () => config.effectiveSettings.value['appearance.theme'] ?? 'system',
)

const lastCheckedLabel = computed(() => {
  const at = updater.lastCheckedAt.value
  if (!at) {
    return null
  }
  return at.toLocaleString()
})

const downloadProgressPercent = computed(() => {
  const current = updater.progress.value
  if (!current || current.contentLength <= 0) {
    return 0
  }
  return Math.min(100, Math.round((current.downloaded / current.contentLength) * 100))
})

const downloadProgressLabel = computed(() => {
  const current = updater.progress.value
  if (!current) {
    return 'Downloading update...'
  }
  if (current.contentLength <= 0) {
    return `Downloading... ${current.downloaded} bytes`
  }
  return `${current.downloaded} / ${current.contentLength} bytes`
})

const setTheme = async (value: VixlTheme): Promise<void> => {
  try {
    await config.setTheme('personal', value)
  } catch (error) {
    toast.error('Failed to save theme', {
      description: formatUnknownError(error),
    })
  }
}

const handleCheckForUpdates = async (): Promise<void> => {
  try {
    await updater.checkForUpdates({ silent: false })
  } catch (error) {
    toast.error('Failed to check for updates', {
      description: formatUnknownError(error),
    })
  }
}

const handleDownloadAndRestart = async (): Promise<void> => {
  try {
    await updater.downloadAndInstall()
  } catch (error) {
    toast.error('Failed to install update', {
      description: formatUnknownError(error),
    })
  }
}
</script>

<template>
  <SettingsSectionScroll title="General">
    <div class="space-y-6">
      <div class="flex items-center gap-1">
        <Label>Theme</Label>
        <Tooltip
          v-for="option in themeOptions"
          :key="option.value"
        >
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7"
              :class="theme === option.value ? 'bg-muted text-foreground' : 'text-muted-foreground'"
              :aria-label="option.label"
              :aria-pressed="theme === option.value"
              @click="setTheme(option.value)"
            >
              <component
                :is="option.icon"
                class="h-4 w-4"
              />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ option.label }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="space-y-2">
        <div class="flex items-center gap-1">
          <Label>Keyboard shortcuts</Label>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                aria-label="View shortcuts"
                @click="shortcutsOpen = true"
              >
                <Keyboard class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View shortcuts</TooltipContent>
          </Tooltip>
        </div>
        <p class="text-sm text-muted-foreground">
          Cmd/Ctrl+K command palette, Cmd/Ctrl+N new agent, Cmd/Ctrl+B left sidebar,
          Cmd/Ctrl+Shift+B right workbench
        </p>
      </div>

      <div class="space-y-2">
        <div class="flex items-center gap-1">
          <Label>Updates</Label>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7"
                aria-label="Check for updates"
                :disabled="updater.checking.value"
                @click="handleCheckForUpdates"
              >
                <Loader2
                  v-if="updater.checking.value"
                  class="h-4 w-4 animate-spin"
                />
                <RefreshCw
                  v-else
                  class="h-4 w-4"
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Check for updates</TooltipContent>
          </Tooltip>
        </div>
        <div
          v-if="updater.updateAvailable.value"
          class="space-y-3 rounded-md border border-border bg-muted/30 p-3"
        >
          <p class="text-sm font-medium">
            Update available: v{{ updater.updateAvailable.value.version }}
          </p>
          <p
            v-if="updater.updateAvailable.value.body"
            class="whitespace-pre-wrap text-sm text-muted-foreground"
          >
            {{ updater.updateAvailable.value.body }}
          </p>
          <Button
            size="sm"
            class="w-fit"
            :disabled="updater.downloading.value"
            @click="handleDownloadAndRestart"
          >
            {{ updater.downloading.value ? 'Downloading...' : 'Download and restart' }}
          </Button>
          <div v-if="updater.downloading.value" class="space-y-2">
            <Progress
              v-if="updater.progress.value && updater.progress.value.contentLength > 0"
              :model-value="downloadProgressPercent"
            />
            <p class="text-xs text-muted-foreground">{{ downloadProgressLabel }}</p>
          </div>
        </div>

        <p
          v-else-if="lastCheckedLabel"
          class="text-sm text-muted-foreground"
        >
          Last checked: {{ lastCheckedLabel }}
        </p>
      </div>
    </div>

    <Dialog :open="shortcutsOpen" @update:open="(open) => (shortcutsOpen = open)">
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <div class="space-y-2 text-sm">
          <div
            v-for="shortcut in appShortcutHelp"
            :key="shortcut.keys"
            class="flex justify-between gap-4"
          >
            <span>{{ shortcut.keys }}</span>
            <span class="text-muted-foreground">{{ shortcut.action }}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </SettingsSectionScroll>
</template>
