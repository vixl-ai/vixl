<script setup lang="ts">
import { computed } from 'vue'
import { AppIcon, APP_ICON_PREVIEW_GROUPS, provideIconAppearance, type AppIconName } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { THEME_ICON_PACKS, type VixlThemeIconAppearance } from '@/types/appearance/theme'
import {
  THEME_ICON_SIZE_SCALE_MAX,
  THEME_ICON_SIZE_SCALE_MIN,
  THEME_ICON_WEIGHT_MAX,
  THEME_ICON_WEIGHT_MIN,
} from '@/schemas/appearance/theme'
import { isValidHexColor } from './appearance-ui'

/**
 * Icon appearance editor: pack selection plus normalized weight, size scale,
 * and optional tint, with a representative icon grid preview (navigation,
 * actions, status, directional, destructive icons) rendered through the real
 * AppIcon runtime so what you see matches what ships.
 *
 * File-type icons (vscode-material-icons), provider logos, and content
 * artwork are intentionally outside the icon-pack system.
 */

const props = defineProps<{
  icons: VixlThemeIconAppearance
}>()

const emit = defineEmits<{
  'update:icons': [icons: VixlThemeIconAppearance]
}>()

// Scope this subtree's AppIcons to the draft appearance so the preview grid
// and any nested editor chrome render the unsaved selection live.
provideIconAppearance(computed(() => props.icons))

const PACK_LABELS = {
  lucide: 'Lucide',
  tabler: 'Tabler',
  phosphor: 'Phosphor',
} as const

const patch = (partial: Partial<VixlThemeIconAppearance>): void => {
  emit('update:icons', { ...props.icons, ...partial })
}

const setWeight = (value: string | number): void => {
  const weight = Number(value)
  if (!Number.isFinite(weight)) {
    return
  }
  const clamped = Math.min(THEME_ICON_WEIGHT_MAX, Math.max(THEME_ICON_WEIGHT_MIN, weight))
  patch({ weight: Math.round(clamped * 2) / 2 })
}

const setSizeScale = (value: string | number): void => {
  const sizeScale = Number(value)
  if (!Number.isFinite(sizeScale)) {
    return
  }
  const clamped = Math.min(
    THEME_ICON_SIZE_SCALE_MAX,
    Math.max(THEME_ICON_SIZE_SCALE_MIN, sizeScale),
  )
  patch({ sizeScale: Math.round(clamped * 100) / 100 })
}

const setTint = (value: string): void => {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed === 'inherit') {
    patch({ tint: 'inherit' })
    return
  }
  if (isValidHexColor(trimmed)) {
    patch({ tint: trimmed })
  }
}

const weightOptions = computed(() => {
  const options: number[] = []
  for (let w = THEME_ICON_WEIGHT_MIN; w <= THEME_ICON_WEIGHT_MAX + 0.001; w += 0.5) {
    options.push(Math.round(w * 2) / 2)
  }
  return options
})

const previewIconsFor = (icons: readonly AppIconName[]): AppIconName[] => icons.slice(0, 8)
</script>

<template>
  <div class="space-y-4" data-testid="appearance-icon-editor">
    <!-- Pack -->
    <div class="space-y-1.5">
      <Label>Icon pack</Label>
      <div class="flex items-center gap-1" role="group" aria-label="Icon pack">
        <Button
          v-for="pack in THEME_ICON_PACKS"
          :key="pack"
          variant="ghost"
          size="sm"
          :class="icons.pack === pack ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="icons.pack === pack"
          @click="patch({ pack })"
        >
          {{ PACK_LABELS[pack] }}
        </Button>
      </div>
    </div>

    <!-- Weight / size -->
    <div class="grid gap-3 sm:grid-cols-2">
      <div class="space-y-1.5">
        <Label for="appearance-icon-weight">Stroke weight</Label>
        <select
          id="appearance-icon-weight"
          class="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
          :value="icons.weight"
          @change="setWeight(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="weight in weightOptions" :key="weight" :value="weight">
            {{ weight }}
          </option>
        </select>
      </div>
      <div class="space-y-1.5">
        <Label for="appearance-icon-scale">Size scale</Label>
        <Input
          id="appearance-icon-scale"
          type="number"
          :min="THEME_ICON_SIZE_SCALE_MIN"
          :max="THEME_ICON_SIZE_SCALE_MAX"
          step="0.05"
          class="h-8"
          :model-value="icons.sizeScale"
          @update:model-value="setSizeScale($event)"
        />
      </div>
    </div>

    <!-- Tint -->
    <div class="space-y-1.5">
      <Label for="appearance-icon-tint">Tint</Label>
      <div class="flex items-center gap-2">
        <Input
          id="appearance-icon-tint"
          class="h-8 w-40 font-mono"
          placeholder="inherit"
          :model-value="icons.tint"
          @update:model-value="setTint(String($event))"
        />
        <Button
          variant="ghost"
          size="sm"
          :class="icons.tint === 'inherit' ? 'bg-muted text-foreground' : 'text-muted-foreground'"
          :aria-pressed="icons.tint === 'inherit'"
          @click="patch({ tint: 'inherit' })"
        >
          Inherit current color
        </Button>
      </div>
      <p v-if="icons.tint !== 'inherit'" class="text-xs text-muted-foreground">
        A fixed tint overrides status colors; keep `inherit` so destructive/success states keep
        their meaning.
      </p>
    </div>

    <!-- Preview grid -->
    <div class="space-y-2">
      <p class="text-xs font-medium text-muted-foreground">Preview</p>
      <div
        v-for="group in APP_ICON_PREVIEW_GROUPS"
        :key="group.label"
        class="flex flex-wrap items-center gap-1"
        role="img"
        :aria-label="`${group.label} icon preview`"
      >
        <span class="w-20 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
          {{ group.label }}
        </span>
        <span
          v-for="name in previewIconsFor(group.icons)"
          :key="name"
          class="inline-flex size-7 items-center justify-center rounded border border-border"
        >
          <AppIcon :name="name" :label="name" size="16" />
        </span>
      </div>
    </div>
  </div>
</template>
