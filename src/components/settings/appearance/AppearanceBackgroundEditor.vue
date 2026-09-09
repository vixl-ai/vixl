<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import type { VixlThemeCanvas, VixlThemeCanvasLayer } from '@/types/appearance/theme'
import {
  CANVAS_BACKGROUND_PRESETS,
  applyCanvasPreset,
  normalizeCanvas,
  reduceCanvasEffects,
} from '@/utils/appearance/canvas-presets'
import type { CanvasBackgroundPresetId } from '@/utils/appearance/canvas-presets'
import AppearanceColorField from './AppearanceColorField.vue'
import AppearanceCanvasLayerEditor from './AppearanceCanvasLayerEditor.vue'

const props = defineProps<{
  canvas: VixlThemeCanvas
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:canvas': [canvas: VixlThemeCanvas]
}>()

/**
 * Layered canvas background editor.
 *
 * Edits the v2 canvas: the solid fallback color plus up to four ordered
 * linear/radial/conic gradient layers, with add/remove/reorder/duplicate
 * layer controls (delegated to `AppearanceCanvasLayerEditor`), bundled
 * presets, and a one-click "reduce effects" action. Every emitted canvas is
 * normalized (bounded geometry, sorted stops, safe fallback) so drafts always
 * round-trip through the strict v2 schema. All controls are native,
 * keyboard-operable inputs with explicit labels.
 */

const layers = computed(() => props.canvas.layers)
const canAddLayer = computed(() => layers.value.length < 4)

const emitCanvas = (canvas: VixlThemeCanvas): void => {
  emit('update:canvas', normalizeCanvas(canvas))
}

const setFallback = (color: string): void => {
  emitCanvas({ ...props.canvas, fallback: color })
}

const setLayers = (layers: VixlThemeCanvasLayer[]): void => {
  emitCanvas({ fallback: props.canvas.fallback, layers })
}

const updateLayer = (index: number, layer: VixlThemeCanvasLayer): void => {
  setLayers(layers.value.map((current, currentIndex) => (currentIndex === index ? layer : current)))
}

const addLayer = (kind: VixlThemeCanvasLayer['kind']): void => {
  if (!canAddLayer.value) {
    return
  }
  const base = props.canvas.fallback
  const stop = (position: number) => ({ color: base, position })
  const layer: VixlThemeCanvasLayer =
    kind === 'linear'
      ? { kind: 'linear', angle: 180, stops: [stop(0), stop(100)] }
      : kind === 'radial'
        ? { kind: 'radial', x: 50, y: 50, size: 'farthest-corner', stops: [stop(0), stop(100)] }
        : { kind: 'conic', angle: 0, x: 50, y: 50, stops: [stop(0), stop(100)] }
  setLayers([...layers.value, layer])
}

const removeLayer = (index: number): void => {
  setLayers(layers.value.filter((_, layerIndex) => layerIndex !== index))
}

const duplicateLayer = (index: number): void => {
  const layer = layers.value[index]
  if (!layer || !canAddLayer.value) {
    return
  }
  const next = [...layers.value]
  next.splice(index + 1, 0, structuredClone(layer))
  setLayers(next)
}

/** Move a layer within the paint order (earlier layers paint above later). */
const moveLayer = (index: number, offset: -1 | 1): void => {
  const target = index + offset
  if (target < 0 || target >= layers.value.length) {
    return
  }
  const next = [...layers.value]
  const [layer] = next.splice(index, 1)
  if (layer) {
    next.splice(target, 0, layer)
  }
  setLayers(next)
}

const applyPreset = (id: CanvasBackgroundPresetId): void => {
  emit('update:canvas', applyCanvasPreset(id, props.canvas))
}

const reduceEffects = (): void => {
  emit('update:canvas', reduceCanvasEffects(props.canvas))
}
</script>

<template>
  <div class="space-y-4">
    <AppearanceColorField
      label="Fallback color"
      :model-value="canvas.fallback"
      :disabled="disabled"
      @update:model-value="setFallback"
    />

    <!-- Presets -->
    <div class="space-y-1" role="group" aria-label="Canvas background presets">
      <p class="text-sm font-medium">Presets</p>
      <div class="flex flex-wrap gap-1">
        <Button
          v-for="preset in CANVAS_BACKGROUND_PRESETS"
          :key="preset.id"
          variant="outline"
          size="sm"
          :disabled="disabled"
          :title="preset.description"
          :aria-label="`Apply ${preset.label} preset: ${preset.description}`"
          @click="applyPreset(preset.id)"
        >
          {{ preset.label }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :disabled="disabled"
          aria-label="Reduce effects: remove all gradient layers and keep the solid fallback color"
          @click="reduceEffects"
        >
          <AppIcon name="wand" class="h-4 w-4" />
          Reduce effects
        </Button>
      </div>
    </div>

    <!-- Layers -->
    <div class="space-y-2">
      <p class="text-sm font-medium">
        Gradient layers ({{ layers.length }}/4) — earlier layers paint above later ones
      </p>

      <AppearanceCanvasLayerEditor
        v-for="(layer, index) in layers"
        :key="index"
        :layer="layer"
        :index="index"
        :total="layers.length"
        :disabled="disabled"
        @update:layer="(updated) => updateLayer(index, updated)"
        @move="moveLayer"
        @duplicate="duplicateLayer"
        @remove="removeLayer"
      />

      <p v-if="layers.length === 0" class="text-xs text-muted-foreground">
        No gradient layers — the canvas renders as the solid fallback color.
      </p>
    </div>

    <!-- Add layer -->
    <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Add gradient layer">
      <span class="min-w-16 text-xs text-muted-foreground">Add layer:</span>
      <Button
        variant="outline"
        size="sm"
        :disabled="disabled || !canAddLayer"
        aria-label="Add a linear gradient layer"
        @click="addLayer('linear')"
      >
        <AppIcon name="plus" class="h-4 w-4" />
        Linear
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="disabled || !canAddLayer"
        aria-label="Add a radial gradient layer"
        @click="addLayer('radial')"
      >
        <AppIcon name="plus" class="h-4 w-4" />
        Radial
      </Button>
      <Button
        variant="outline"
        size="sm"
        :disabled="disabled || !canAddLayer"
        aria-label="Add a conic gradient layer"
        @click="addLayer('conic')"
      >
        <AppIcon name="plus" class="h-4 w-4" />
        Conic
      </Button>
    </div>
  </div>
</template>
