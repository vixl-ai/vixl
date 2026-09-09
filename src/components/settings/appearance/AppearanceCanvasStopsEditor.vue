<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import type { VixlThemeGradientStop } from '@/types/appearance/theme'
import {
  THEME_CANVAS_LAYER_STOP_MAX,
  THEME_CANVAS_LAYER_STOP_MIN,
} from '@/utils/appearance/canvas-presets'

defineProps<{
  /** Owning layer index, used for accessible labels. */
  layerIndex: number
  stops: VixlThemeGradientStop[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:color': [stopIndex: number, color: string]
  'update:position': [stopIndex: number, position: number]
  'add-stop': []
  'remove-stop': [stopIndex: number]
}>()

/**
 * Stop rows for one canvas layer: color picker plus alpha-capable hex text
 * and a 0-100 position field per stop, with add/remove controls. Values are
 * clamped and stop-sorted by the owning layer editor on emit.
 */
</script>

<template>
  <div class="space-y-2">
    <p class="text-xs font-medium text-muted-foreground">
      Stops ({{ stops.length }}/{{ THEME_CANVAS_LAYER_STOP_MAX }})
    </p>
    <div v-for="(stop, stopIndex) in stops" :key="stopIndex" class="flex items-center gap-2">
      <span class="min-w-14 text-xs text-muted-foreground">Stop {{ stopIndex + 1 }}</span>
      <input
        type="color"
        class="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0"
        :value="stop.color"
        :disabled="disabled"
        :aria-label="`Layer ${layerIndex + 1} stop ${stopIndex + 1} color picker`"
        @input="emit('update:color', stopIndex, ($event.target as HTMLInputElement).value)"
      />
      <Input
        class="h-7 w-28 font-mono text-xs"
        :model-value="stop.color"
        :disabled="disabled"
        :aria-label="`Layer ${layerIndex + 1} stop ${stopIndex + 1} hex value (alpha-capable)`"
        spellcheck="false"
        @update:model-value="
          (value: string | number) => emit('update:color', stopIndex, String(value))
        "
      />
      <Input
        class="h-7 w-20"
        type="number"
        :min="0"
        :max="100"
        :model-value="stop.position"
        :disabled="disabled"
        :aria-label="`Layer ${layerIndex + 1} stop ${stopIndex + 1} position percent`"
        @update:model-value="
          (value: string | number) => emit('update:position', stopIndex, Number(value))
        "
      />
      <span class="text-xs text-muted-foreground">%</span>
      <Button
        variant="ghost"
        size="icon-sm"
        :disabled="disabled || stops.length <= THEME_CANVAS_LAYER_STOP_MIN"
        :aria-label="`Remove stop ${stopIndex + 1} from layer ${layerIndex + 1}`"
        @click="emit('remove-stop', stopIndex)"
      >
        <AppIcon name="minus" class="h-4 w-4" />
      </Button>
    </div>
    <Button
      variant="outline"
      size="sm"
      :disabled="disabled || stops.length >= THEME_CANVAS_LAYER_STOP_MAX"
      :aria-label="`Add stop to layer ${layerIndex + 1}`"
      @click="emit('add-stop')"
    >
      <AppIcon name="plus" class="h-4 w-4" />
      Add stop
    </Button>
  </div>
</template>
