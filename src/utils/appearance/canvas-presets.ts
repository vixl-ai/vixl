import type {
  VixlThemeCanvas,
  VixlThemeCanvasLayer,
  VixlThemeGradientStop,
} from '@/types/appearance/theme'
import {
  THEME_CANVAS_LAYER_STOP_MAX,
  THEME_CANVAS_LAYER_STOP_MIN,
  THEME_CANVAS_MAX_LAYERS,
} from '@/schemas/appearance/theme'

/**
 * Pure canvas normalization and bundled background presets.
 *
 * Layered canvases must always round-trip through the strict v2 schema:
 * bounded geometry (angles 0-360, origins 0-100 percent), 2-6 stops sorted by
 * ascending position, at most four layers, and a safe hex fallback color that
 * renders whenever gradient layers are unsupported. These helpers are the
 * single normalization point shared by the background editor, the editor
 * draft store, and canonical export.
 */

const clampPercent = (value: number): number => {
  if (!Number.isFinite(value)) {
    return value > 0 ? 100 : 0
  }
  return Math.min(100, Math.max(0, Math.round(value)))
}

const clampAngle = (value: number): number =>
  Number.isFinite(value) ? ((Math.round(value) % 360) + 360) % 360 : 0

/** Opaque color used when a canvas fallback is missing or empty. */
export const SAFE_CANVAS_FALLBACK = '#000000'

/**
 * The solid fallback is the last-resort paint for surfaces that cannot render
 * gradient layers, so an empty/missing fallback is replaced with an opaque
 * safe color. Non-empty values pass through trimmed; final hex validity is
 * enforced by the strict schema at save/import time (and invalid values are
 * simply ignored by the CSS cascade, never rendered unsafely).
 */
const safeFallback = (fallback: string): string => {
  const trimmed = typeof fallback === 'string' ? fallback.trim() : ''
  return trimmed.length > 0 ? trimmed : SAFE_CANVAS_FALLBACK
}

const normalizeStops = (stops: readonly VixlThemeGradientStop[]): VixlThemeGradientStop[] =>
  stops
    .filter((stop) => stop !== null && typeof stop === 'object')
    .map((stop) => ({
      // Colors pass through trimmed so in-progress hex typing in the editor
      // is preserved; final validity is enforced by the strict schema.
      color: typeof stop.color === 'string' ? stop.color.trim() : SAFE_CANVAS_FALLBACK,
      position: clampPercent(stop.position),
    }))
    .sort((a, b) => a.position - b.position)

/** Normalize one layer: bounded geometry, safe stops, sorted positions. */
export const normalizeCanvasLayer = (layer: VixlThemeCanvasLayer): VixlThemeCanvasLayer => {
  const stops = normalizeStops(layer.stops ?? [])
  if (layer.kind === 'radial') {
    return {
      kind: 'radial',
      x: clampPercent(layer.x),
      y: clampPercent(layer.y),
      size: layer.size,
      stops,
    }
  }
  if (layer.kind === 'conic') {
    return {
      kind: 'conic',
      angle: clampAngle(layer.angle),
      x: clampPercent(layer.x),
      y: clampPercent(layer.y),
      stops,
    }
  }
  return { kind: 'linear', angle: clampAngle(layer.angle), stops }
}

/**
 * Normalize a full canvas: bounded layer count (excess layers are dropped),
 * per-layer normalization, and a guaranteed safe hex fallback.
 */
export const normalizeCanvas = (canvas: VixlThemeCanvas): VixlThemeCanvas => ({
  fallback: safeFallback(canvas?.fallback ?? ''),
  layers: (canvas?.layers ?? []).slice(0, THEME_CANVAS_MAX_LAYERS).map(normalizeCanvasLayer),
})

/** Drop all gradient layers, keeping only the solid fallback canvas. */
export const reduceCanvasEffects = (canvas: VixlThemeCanvas): VixlThemeCanvas => ({
  fallback: safeFallback(canvas?.fallback ?? ''),
  layers: [],
})

/** ---------------------------------------------------------------- presets */

/** Ids of the bundled canvas background presets shown in the editor. */
export type CanvasBackgroundPresetId = 'aurora-mesh' | 'sunset' | 'spotlight' | 'minimal-glow'

export type CanvasBackgroundPreset = {
  id: CanvasBackgroundPresetId
  label: string
  /** One-line description of the look, surfaced as the button tooltip/aria. */
  description: string
  /** Gradient layers painted over the canvas fallback (first layer on top). */
  layers: VixlThemeCanvasLayer[]
}

export const CANVAS_BACKGROUND_PRESETS: readonly CanvasBackgroundPreset[] = [
  {
    id: 'aurora-mesh',
    label: 'Aurora Mesh',
    description: 'Multi-radial indigo/cyan/violet aurora mesh',
    layers: [
      {
        kind: 'radial',
        x: 20,
        y: 15,
        size: 'closest-side',
        stops: [
          { color: '#6366f166', position: 0 },
          { color: '#6366f100', position: 100 },
        ],
      },
      {
        kind: 'radial',
        x: 80,
        y: 30,
        size: 'farthest-side',
        stops: [
          { color: '#22d3ee55', position: 0 },
          { color: '#22d3ee00', position: 100 },
        ],
      },
      {
        kind: 'radial',
        x: 55,
        y: 90,
        size: 'farthest-corner',
        stops: [
          { color: '#a855f744', position: 0 },
          { color: '#a855f700', position: 100 },
        ],
      },
    ],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    description: 'Warm amber-to-coral diagonal with a soft glow',
    layers: [
      {
        kind: 'linear',
        angle: 160,
        stops: [
          { color: '#fbbf24', position: 0 },
          { color: '#fb7185', position: 55 },
          { color: '#7c3aed', position: 100 },
        ],
      },
      {
        kind: 'radial',
        x: 25,
        y: 20,
        size: 'closest-side',
        stops: [
          { color: '#ffffff55', position: 0 },
          { color: '#ffffff00', position: 100 },
        ],
      },
    ],
  },
  {
    id: 'spotlight',
    label: 'Spotlight',
    description: 'Single centered radial highlight',
    layers: [
      {
        kind: 'radial',
        x: 50,
        y: 40,
        size: 'farthest-corner',
        stops: [
          { color: '#ffffff44', position: 0 },
          { color: '#ffffff00', position: 70 },
          { color: '#ffffff00', position: 100 },
        ],
      },
    ],
  },
  {
    id: 'minimal-glow',
    label: 'Minimal Glow',
    description: 'Subtle corner glow over the fallback color',
    layers: [
      {
        kind: 'radial',
        x: 85,
        y: 90,
        size: 'closest-side',
        stops: [
          { color: '#94a3b833', position: 0 },
          { color: '#94a3b800', position: 100 },
        ],
      },
    ],
  },
]

export const canvasBackgroundPresetById = (
  id: CanvasBackgroundPresetId,
): CanvasBackgroundPreset | undefined =>
  CANVAS_BACKGROUND_PRESETS.find((preset) => preset.id === id)

/**
 * Apply a preset over an existing canvas: preset layers replace all current
 * layers; the solid fallback color is preserved. Output is normalized.
 */
export const applyCanvasPreset = (
  id: CanvasBackgroundPresetId,
  canvas: VixlThemeCanvas,
): VixlThemeCanvas => {
  const preset = canvasBackgroundPresetById(id)
  const fallback = safeFallback(canvas?.fallback ?? '')
  if (!preset) {
    return { fallback, layers: [] }
  }
  return normalizeCanvas({
    fallback,
    layers: preset.layers.map((layer) => structuredClone(layer)),
  })
}

export { clampPercent as clampCanvasPercent, clampAngle as clampCanvasAngle }

/** Re-exported for editor stop bounds without importing the schema twice. */
export { THEME_CANVAS_LAYER_STOP_MAX, THEME_CANVAS_LAYER_STOP_MIN }
