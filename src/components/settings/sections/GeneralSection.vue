<script setup lang="ts">
import { Keyboard, Loader2, Monitor, Moon, RefreshCw, Sun } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { Slider } from '@/components/shadcn/ui/slider'
import { Switch } from '@/components/shadcn/ui/switch'
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

const { VITE_APP_VERSION: appVersion, VITE_GIT_SHA: gitSha } = import.meta.env

const themeOptions = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
] as const

const config = useVixlConfig()
const updater = useAppUpdater()
const { previewTransparency } = useTransparency()
const colorMode = useColorMode()
const shortcutsOpen = ref(false)
const transparencyHue = ref([
  config.effectiveSettings.value['appearance.transparencyHue'] ?? 265,
])
const transparencyIntensity = ref([
  config.effectiveSettings.value['appearance.transparencyIntensity'] ?? 0,
])

const versionLabel = computed(() => {
  const version = appVersion || 'unknown'
  if (gitSha && gitSha !== 'unknown') {
    return `v${version} (${gitSha})`
  }
  return `v${version}`
})

const theme = computed(
  () => config.effectiveSettings.value['appearance.theme'] ?? 'system',
)

const transparency = computed(
  () => config.effectiveSettings.value['appearance.transparency'] ?? true,
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

const hsvToRgb = (h: number, s: number, v: number): string => {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  const rgb = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6] ?? [v, t, p]
  return `rgb(${rgb.map((c) => Math.round(c * 255)).join(', ')})`
}

// HSV constants mirror src-tauri/src/vibrancy/apply.rs apply_macos_tint (hue/360, dark 0.55/0.65, light 0.45/0.95).
const huePreviewColor = computed(() => {
  const isDark = colorMode.state.value === 'dark'
  return hsvToRgb((transparencyHue.value[0] ?? 265) / 360, isDark ? 0.55 : 0.45, isDark ? 0.65 : 0.95)
})

const saveTransparencySetting = async (action: () => Promise<void>): Promise<void> => {
  try {
    await action()
  } catch (error) {
    toast.error('Failed to save transparency setting', {
      description: formatUnknownError(error),
    })
  }
}

const setTheme = async (value: VixlTheme): Promise<void> => {
  try {
    await config.setTheme('personal', value)
  } catch (error) {
    toast.error('Failed to save theme', {
      description: formatUnknownError(error),
    })
  }
}

const setTransparency = async (enabled: boolean): Promise<void> => {
  await saveTransparencySetting(() => config.setTransparency('personal', enabled))
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

const persistHue = async (value: number | undefined): Promise<void> => {
  if (value === undefined || value === (config.effectiveSettings.value['appearance.transparencyHue'] ?? 265)) {
    return
  }
  await saveTransparencySetting(() => config.setTransparencyHue('personal', value))
}

const persistIntensity = async (value: number | undefined): Promise<void> => {
  if (
    value === undefined ||
    value === (config.effectiveSettings.value['appearance.transparencyIntensity'] ?? 0)
  ) {
    return
  }
  await saveTransparencySetting(() => config.setTransparencyIntensity('personal', value))
}

watch(
  () =>
    [
      config.effectiveSettings.value['appearance.transparencyHue'] ?? 265,
      config.effectiveSettings.value['appearance.transparencyIntensity'] ?? 0,
    ] as [number, number],
  ([hue, intensity]) => {
    if (transparencyHue.value[0] !== hue) {
      transparencyHue.value = [hue]
    }
    if (transparencyIntensity.value[0] !== intensity) {
      transparencyIntensity.value = [intensity]
    }
  },
)

watchDebounced(() => transparencyHue.value[0], persistHue, { debounce: 300 })
watchDebounced(() => transparencyIntensity.value[0], persistIntensity, { debounce: 300 })

watchThrottled(
  () => [transparencyHue.value[0], transparencyIntensity.value[0]] as const,
  ([hue, intensity]) => {
    if (!transparency.value || hue === undefined || intensity === undefined) {
      return
    }
    previewTransparency(hue, intensity)
  },
  { throttle: 64 },
)
</script>

<template>
  <SettingsSectionScroll title="General">
    <div class="space-y-6">
      <div class="flex items-center gap-1">
        <Label>Theme</Label>
        <Tooltip v-for="option in themeOptions" :key="option.value">
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
              <component :is="option.icon" class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ option.label }}</TooltipContent>
        </Tooltip>
      </div>

      <div class="space-y-2">
        <Label>Transparency</Label>
        <div class="flex items-center gap-1">
          <Label>Enabled</Label>
          <Switch
            :model-value="transparency"
            aria-label="Transparency enabled"
            @update:model-value="setTransparency"
          />
        </div>
        <template v-if="transparency">
          <div class="flex items-center gap-2">
            <Label class="shrink-0">Hue</Label>
            <Slider v-model="transparencyHue" :min="0" :max="360" :step="1" class="w-40" aria-label="Transparency hue" />
            <span class="size-4 shrink-0 rounded-full border border-border/50" :style="{ backgroundColor: huePreviewColor }" />
          </div>
          <div class="flex items-center gap-2">
            <Label class="shrink-0">Intensity</Label>
            <Slider v-model="transparencyIntensity" :min="0" :max="100" :step="1" class="w-40" aria-label="Transparency intensity" />
          </div>
        </template>
      </div>

      <div class="flex items-center gap-1">
        <Label>Keyboard shortcuts</Label>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="ghost" size="icon" class="h-7 w-7" aria-label="View shortcuts" @click="shortcutsOpen = true">
              <Keyboard class="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>View shortcuts</TooltipContent>
        </Tooltip>
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
                <Loader2 v-if="updater.checking.value" class="h-4 w-4 animate-spin" />
                <RefreshCw v-else class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Check for updates</TooltipContent>
          </Tooltip>
        </div>
        <p class="text-sm text-muted-foreground">Current version: {{ versionLabel }}</p>
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
          <Button size="sm" class="w-fit" :disabled="updater.downloading.value" @click="handleDownloadAndRestart">
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
        <p v-else-if="lastCheckedLabel" class="text-sm text-muted-foreground">
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
          <div v-for="shortcut in appShortcutHelp" :key="shortcut.keys" class="flex justify-between gap-4">
            <span>{{ shortcut.keys }}</span>
            <span class="text-muted-foreground">{{ shortcut.action }}</span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  </SettingsSectionScroll>
</template>
