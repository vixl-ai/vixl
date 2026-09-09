import { describe, expect, it } from 'vitest'
import type { VixlThemeCanvas } from '@/types/appearance/theme'
import { themeCanvasSchema } from '@/schemas/appearance/theme'
import { buildCanvasCss } from '@/utils/appearance/appearance-css'
import { canvasToCss } from '@/components/settings/appearance/appearance-ui'
import {
  CANVAS_BACKGROUND_PRESETS,
  SAFE_CANVAS_FALLBACK,
  applyCanvasPreset,
  normalizeCanvas,
  normalizeCanvasLayer,
  reduceCanvasEffects,
} from '@/utils/appearance/canvas-presets'
import type { CanvasBackgroundPresetId } from '@/utils/appearance/canvas-presets'

describe('normalizeCanvasLayer', () => {
  it('clamps linear angles and sorts stops by ascending position', () => {
    const layer = normalizeCanvasLayer({
      kind: 'linear',
      angle: 450,
      stops: [
        { color: '#ffffff', position: 100 },
        { color: '#000000', position: -20 },
        { color: '#111111', position: 240 },
      ],
    })
    expect(layer).toEqual({
      kind: 'linear',
      angle: 90,
      stops: [
        { color: '#000000', position: 0 },
        { color: '#ffffff', position: 100 },
        { color: '#111111', position: 100 },
      ],
    })
  })

  it('clamps radial centers into 0-100 percent', () => {
    const layer = normalizeCanvasLayer({
      kind: 'radial',
      x: -10,
      y: 150,
      size: 'closest-side',
      stops: [
        { color: '#111111', position: 0 },
        { color: '#222222', position: 100 },
      ],
    })
    expect(layer).toMatchObject({ kind: 'radial', x: 0, y: 100, size: 'closest-side' })
  })

  it('clamps conic angles and origins', () => {
    const layer = normalizeCanvasLayer({
      kind: 'conic',
      angle: 405,
      x: 120,
      y: -5,
      stops: [
        { color: '#111111', position: 0 },
        { color: '#222222', position: 100 },
      ],
    })
    expect(layer).toMatchObject({ kind: 'conic', angle: 45, x: 100, y: 0 })
  })

  it('treats non-finite geometry as zero', () => {
    const layer = normalizeCanvasLayer({
      kind: 'radial',
      x: Number.NaN,
      y: Number.POSITIVE_INFINITY,
      size: 'farthest-corner',
      stops: [
        { color: '#111111', position: 0 },
        { color: '#222222', position: 100 },
      ],
    })
    expect(layer).toMatchObject({ x: 0, y: 100 })
  })
})

describe('normalizeCanvas', () => {
  it('caps the layer count at the schema maximum (4)', () => {
    const layer = {
      kind: 'linear' as const,
      angle: 90,
      stops: [
        { color: '#111111', position: 0 },
        { color: '#222222', position: 100 },
      ],
    }
    const canvas = normalizeCanvas({
      fallback: '#101018',
      layers: [layer, layer, layer, layer, layer, layer],
    })
    expect(canvas.layers).toHaveLength(4)
  })

  it('replaces an empty fallback with the safe opaque color', () => {
    expect(normalizeCanvas({ fallback: '', layers: [] }).fallback).toBe(SAFE_CANVAS_FALLBACK)
    expect(normalizeCanvas({ fallback: '   ', layers: [] }).fallback).toBe(SAFE_CANVAS_FALLBACK)
    // Non-empty values pass through so in-progress editor typing survives.
    expect(normalizeCanvas({ fallback: '#f', layers: [] }).fallback).toBe('#f')
  })

  it('produces schema-valid output for arbitrary input', () => {
    const canvas = normalizeCanvas({
      fallback: '#101018',
      layers: [
        {
          kind: 'conic',
          angle: 720,
          x: -4,
          y: 200,
          stops: [
            { color: '#ffffff', position: 300 },
            { color: '#000000', position: 10 },
          ],
        },
      ],
    })
    expect(themeCanvasSchema.safeParse(canvas).success).toBe(true)
  })

  it('tolerates missing layers/fallback fields', () => {
    const canvas = normalizeCanvas({} as VixlThemeCanvas)
    expect(canvas.fallback).toBe(SAFE_CANVAS_FALLBACK)
    expect(canvas.layers).toEqual([])
  })
})

describe('canvas presets', () => {
  it('exposes unique ids and labels for the four bundled presets', () => {
    expect(CANVAS_BACKGROUND_PRESETS.map((preset) => preset.id)).toEqual([
      'aurora-mesh',
      'sunset',
      'spotlight',
      'minimal-glow',
    ])
    expect(new Set(CANVAS_BACKGROUND_PRESETS.map((preset) => preset.label)).size).toBe(
      CANVAS_BACKGROUND_PRESETS.length,
    )
  })

  it('stays within the bounded schema for every preset', () => {
    for (const preset of CANVAS_BACKGROUND_PRESETS) {
      expect(preset.layers.length).toBeLessThanOrEqual(4)
      expect(preset.layers.length).toBeGreaterThan(0)
      for (const layer of preset.layers) {
        expect(layer.stops.length).toBeGreaterThanOrEqual(2)
        expect(layer.stops.length).toBeLessThanOrEqual(6)
        expect(layer.stops.every((stop) => Number.isFinite(stop.position))).toBe(true)
      }
      expect(
        themeCanvasSchema.safeParse({ fallback: '#0b0f19', layers: preset.layers }).success,
      ).toBe(true)
    }
  })

  it('applies presets over the existing fallback color, normalized', () => {
    const canvas = applyCanvasPreset('sunset', { fallback: '#1a1408', layers: [] })
    expect(canvas.fallback).toBe('#1a1408')
    expect(canvas.layers).toEqual(CANVAS_BACKGROUND_PRESETS[1]?.layers)
    expect(themeCanvasSchema.safeParse(canvas).success).toBe(true)
  })

  it('falls back to a plain solid canvas for unknown preset ids', () => {
    const canvas = applyCanvasPreset('not-a-preset' as CanvasBackgroundPresetId, {
      fallback: '#101018',
      layers: [],
    })
    expect(canvas).toEqual({ fallback: '#101018', layers: [] })
  })
})

describe('reduceCanvasEffects', () => {
  it('keeps the fallback and drops all layers', () => {
    const reduced = reduceCanvasEffects({
      fallback: '#101018',
      layers: [
        {
          kind: 'radial',
          x: 50,
          y: 50,
          size: 'closest-side',
          stops: [
            { color: '#ffffff', position: 0 },
            { color: '#000000', position: 100 },
          ],
        },
      ],
    })
    expect(reduced).toEqual({ fallback: '#101018', layers: [] })
  })
})

describe('preview/runtime parity', () => {
  it('canvasToCss composes the same layered value as the runtime serializer', () => {
    const canvas: VixlThemeCanvas = applyCanvasPreset('sunset', { fallback: '#101018', layers: [] })
    const { color, image } = buildCanvasCss(canvas)
    expect(canvasToCss(canvas)).toBe(image === 'none' ? color : `${image}, ${color}`)
    expect(canvasToCss(canvas)).toContain('linear-gradient(160deg')
    expect(canvasToCss(canvas)).toContain('radial-gradient(closest-side at 25% 20%')
  })
})
