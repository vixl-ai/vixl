import type { Component } from 'vue'
import type { VixlThemeIconPack } from '@/types/appearance/theme'
import type { AppIconName } from '../icon-names'

/**
 * Per-pack adapter contract. Adapters translate the theme's normalized icon
 * appearance (semantic name, stroke weight) into the underlying pack's props
 * while keeping `currentColor` behavior intact.
 */
export type IconPackAdapter = {
  /** Pack id stored in theme files. */
  id: VixlThemeIconPack
  /** Semantic name → bundled component (explicit named imports only). */
  components: Record<AppIconName, Component>
  /**
   * Props for the normalized stroke weight (theme domain 1–2.5). Packs without
   * a stroke-width concept return a mapped weight prop instead.
   */
  strokeProps: (weight: number) => Record<string, unknown>
}

/** Quantize to half steps inside the schema-bounded weight domain. */
export const normalizeIconWeight = (weight: number): number =>
  Math.min(2.5, Math.max(1, Math.round(weight * 2) / 2))

/** Map a normalized weight onto Phosphor's named weight scale. */
export const phosphorWeightFor = (weight: number): string => {
  switch (normalizeIconWeight(weight)) {
    case 1:
      return 'thin'
    case 1.5:
      return 'light'
    case 2.5:
      return 'bold'
    default:
      return 'regular'
  }
}
