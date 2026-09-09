<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { NativeSelect } from '@/components/shadcn/ui/native-select'
import { THEME_RADIAL_SIZES } from '@/types/appearance/theme'
import type {
  VixlThemeCanvasLayer,
  VixlThemeGradientStop,
  VixlThemeRadialSize,
} from '@/types/appearance/theme'
import {
  clampCanvasAngle,
  clampCanvasPercent,
  THEME_CANVAS_LAYER_STOP_MAX,
  THEME_CANVAS_LAYER_STOP_MIN,
} from '@/utils/appearance/canvas-presets'
import AppearanceCanvasStopsEditor from './AppearanceCanvasStopsEditor.vue'
import AppearanceCanvasPercentField from './AppearanceCanvasPercentField.vue'

const props = defineProps<{
  layer: VixlThemeCanvasLayer
  /** Zero-based index in the canvas layer list. */
  index: number
  /** Total number of layers (for move/duplicate enablement). */
  total: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:layer': [layer: VixlThemeCanvasLayer]
  move: [index: number, offset: -1 | 1]
  duplicate: [index: number]
  remove: [index: number]
}>()

/**
 * Editor card for one canvas layer: geometry controls per gradient kind plus
 * the 2-6 alpha-capable stops. All emitted layers are already clamped and
 * stop-sorted; the parent normalizes the whole canvas again on emit.
 */

const LAYER_KIND_LABELS: Record<VixlThemeCanvasLayer['kind'], string> = {
  linear: 'Linear',
  radial: 'Radial',
  conic: 'Conic',
}

const canAddLayer = computed(() => props.total < 4)

const updateLayer = (updater: (layer: VixlThemeCanvasLayer) => VixlThemeCanvasLayer): void => {
  emit('update:layer', updater(props.layer))
}

const setStops = (stops: VixlThemeGradientStop[]): void => {
  updateLayer((layer) => ({ ...layer, stops }))
}

const handleAngle = (raw: string | number): void => {
  updateLayer((layer) =>
    layer.kind === 'radial' ? layer : { ...layer, angle: clampCanvasAngle(Number(raw)) },
  )
}

const handleCenter = (axis: 'x' | 'y', raw: string | number): void => {
  updateLayer((layer) =>
    layer.kind === 'linear' ? layer : { ...layer, [axis]: clampCanvasPercent(Number(raw)) },
  )
}

const handleRadialSize = (size: string): void => {
  updateLayer((layer) =>
    layer.kind === 'radial' ? { ...layer, size: size as VixlThemeRadialSize } : layer,
  )
}

const handleStopColor = (stopIndex: number, color: string): void => {
  setStops(
    props.layer.stops.map((stop, current) => (current === stopIndex ? { ...stop, color } : stop)),
  )
}

const handleStopPosition = (stopIndex: number, raw: string | number): void => {
  setStops(
    props.layer.stops.map((stop, current) =>
      current === stopIndex ? { ...stop, position: clampCanvasPercent(Number(raw)) } : stop,
    ),
  )
}

const addStop = (): void => {
  if (props.layer.stops.length >= THEME_CANVAS_LAYER_STOP_MAX) {
    return
  }
  const stops = [...props.layer.stops].sort((a, b) => a.position - b.position)
  const last: VixlThemeGradientStop = stops[stops.length - 1] ?? { color: '#000000', position: 100 }
  const previous: VixlThemeGradientStop = stops[stops.length - 2] ?? { ...last, position: 0 }
  const position = Math.round((previous.position + last.position) / 2)
  stops.splice(stops.length - 1, 0, { color: last.color, position })
  setStops(stops)
}

const removeStop = (stopIndex: number): void => {
  if (props.layer.stops.length <= THEME_CANVAS_LAYER_STOP_MIN) {
    return
  }
  setStops(props.layer.stops.filter((_, current) => current !== stopIndex))
}
</script>

<template>
  <div
    class="space-y-3 rounded-md border border-input p-3"
    :aria-label="`Layer ${index + 1}: ${LAYER_KIND_LABELS[layer.kind]} gradient`"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Layer {{ index + 1 }} · {{ LAYER_KIND_LABELS[layer.kind] }}
      </p>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="disabled || index === 0"
          :aria-label="`Move layer ${index + 1} up (paint above layer ${index})`"
          @click="emit('move', index, -1)"
        >
          <AppIcon name="arrow-up" class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="disabled || index === total - 1"
          :aria-label="`Move layer ${index + 1} down (paint below layer ${index + 2})`"
          @click="emit('move', index, 1)"
        >
          <AppIcon name="arrow-down" class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="disabled || !canAddLayer"
          :aria-label="`Duplicate layer ${index + 1}`"
          @click="emit('duplicate', index)"
        >
          <AppIcon name="copy" class="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="disabled"
          :aria-label="`Remove layer ${index + 1}`"
          @click="emit('remove', index)"
        >
          <AppIcon name="trash" class="h-4 w-4" />
        </Button>
      </div>
    </div>

    <!-- Linear geometry -->
    <div v-if="layer.kind === 'linear'" class="flex items-center gap-3">
      <Label :for="`layer-${index}-angle`" class="min-w-28 text-sm"> Angle </Label>
      <input
        :id="`layer-${index}-angle`"
        type="range"
        min="0"
        max="360"
        step="1"
        class="h-2 w-32 accent-current"
        :value="layer.angle"
        :disabled="disabled"
        aria-label="Layer angle in degrees"
        @input="handleAngle(($event.target as HTMLInputElement).value)"
      />
      <Input
        class="h-7 w-20"
        type="number"
        :min="0"
        :max="360"
        :model-value="layer.angle"
        :disabled="disabled"
        :aria-label="`Layer ${index + 1} angle numeric value`"
        @update:model-value="(value: string | number) => handleAngle(value)"
      />
      <span class="text-xs text-muted-foreground">degrees</span>
    </div>

    <!-- Radial geometry -->
    <div v-else-if="layer.kind === 'radial'" class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <AppearanceCanvasPercentField
          :id="`layer-${index}-x`"
          label="Center X"
          :model-value="layer.x"
          :disabled="disabled"
          :ariaLabel="`Layer ${index + 1} horizontal center percent`"
          @update:model-value="(value: number) => handleCenter('x', value)"
        />
      </div>
      <div class="flex items-center gap-2">
        <AppearanceCanvasPercentField
          :id="`layer-${index}-y`"
          label="Center Y"
          :model-value="layer.y"
          :disabled="disabled"
          :ariaLabel="`Layer ${index + 1} vertical center percent`"
          @update:model-value="(value: number) => handleCenter('y', value)"
        />
      </div>
      <div class="flex items-center gap-2">
        <Label :for="`layer-${index}-size`" class="text-sm">Size</Label>
        <NativeSelect
          :id="`layer-${index}-size`"
          class="h-7 w-44"
          :disabled="disabled"
          :model-value="layer.size"
          :aria-label="`Layer ${index + 1} radial extent`"
          @change="handleRadialSize(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="size in THEME_RADIAL_SIZES" :key="size" :value="size">
            {{ size }}
          </option>
        </NativeSelect>
      </div>
    </div>

    <!-- Conic geometry -->
    <div v-else class="flex flex-wrap items-center gap-3">
      <div class="flex items-center gap-2">
        <Label :for="`layer-${index}-conic-angle`" class="text-sm">From angle</Label>
        <Input
          :id="`layer-${index}-conic-angle`"
          class="h-7 w-20"
          type="number"
          :min="0"
          :max="360"
          :model-value="layer.angle"
          :disabled="disabled"
          :aria-label="`Layer ${index + 1} conic start angle in degrees`"
          @update:model-value="(value: string | number) => handleAngle(value)"
        />
        <span class="text-xs text-muted-foreground">degrees</span>
      </div>
      <div class="flex items-center gap-2">
        <AppearanceCanvasPercentField
          :id="`layer-${index}-conic-x`"
          label="Origin X"
          :model-value="layer.x"
          :disabled="disabled"
          :ariaLabel="`Layer ${index + 1} horizontal origin percent`"
          @update:model-value="(value: number) => handleCenter('x', value)"
        />
      </div>
      <div class="flex items-center gap-2">
        <AppearanceCanvasPercentField
          :id="`layer-${index}-conic-y`"
          label="Origin Y"
          :model-value="layer.y"
          :disabled="disabled"
          :ariaLabel="`Layer ${index + 1} vertical origin percent`"
          @update:model-value="(value: number) => handleCenter('y', value)"
        />
      </div>
    </div>

    <!-- Stops -->
    <AppearanceCanvasStopsEditor
      :layer-index="index"
      :stops="layer.stops"
      :disabled="disabled"
      @update:color="handleStopColor"
      @update:position="handleStopPosition"
      @add-stop="addStop"
      @remove-stop="removeStop"
    />
  </div>
</template>
