/**
 * Reserved built-in theme ids and runtime built-in metadata.
 *
 * The bundled theme definitions themselves live in the bundled-theme registry
 * (`built-in-theme.ts` plus the curated themes). Their ids are reserved ahead
 * of the definitions so custom and imported themes can never take a bundled
 * theme's identity.
 *
 * Runtime metadata is split into two flags:
 * - `readOnlyBuiltIn`: the theme is bundled and immutable — it can be
 *   previewed, exported, and duplicated, but never edited or deleted.
 * - `usesCssDefaults`: the theme's palette exactly matches the hard-coded CSS
 *   cascade defaults, so the runtime clears its variables instead of writing
 *   them. Only the original Vixl Default theme uses CSS defaults; other
 *   read-only built-ins still receive their own runtime variables.
 */

import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import { CURATED_BUNDLED_THEMES } from '@/constants/appearance/bundled'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

/** Runtime metadata for one bundled built-in theme. */
export type BuiltinThemeMeta = {
  id: string
  name: string
  readOnlyBuiltIn: boolean
  usesCssDefaults: boolean
}

/** Metadata for the original built-in Vixl default theme. */
export const BUILTIN_VIXL_THEME_META: BuiltinThemeMeta = {
  id: BUILTIN_VIXL_THEME_ID,
  name: 'Vixl Default',
  readOnlyBuiltIn: true,
  usesCssDefaults: true,
}

/**
 * Ids reserved for the curated bundled themes. The definitions ship with the
 * bundled-theme registry; reserving the ids first keeps custom/imported
 * themes from ever colliding with them.
 */
export const RESERVED_CURATED_BUILTIN_THEME_IDS = [
  'midnight-aurora',
  'nordic-frost',
  'solar-flare',
  'rose-quartz',
  'ocean-depths',
  'cyber-lime',
  'paper-ink',
  'high-contrast',
] as const

export type ReservedCuratedBuiltinThemeId = (typeof RESERVED_CURATED_BUILTIN_THEME_IDS)[number]

/** Registry-wide reserved ids: the default plus every curated built-in. */
export const RESERVED_BUILTIN_THEME_IDS: readonly string[] = [
  BUILTIN_VIXL_THEME_META.id,
  ...RESERVED_CURATED_BUILTIN_THEME_IDS,
]

/** True when the id belongs to any bundled built-in theme. */
export const isReservedThemeId = (id: string): boolean => RESERVED_BUILTIN_THEME_IDS.includes(id)

/** Display names for curated built-ins (kept in sync with definitions). */
const CURATED_BUILTIN_NAMES: Record<ReservedCuratedBuiltinThemeId, string> = {
  'midnight-aurora': 'Midnight Aurora',
  'nordic-frost': 'Nordic Frost',
  'solar-flare': 'Solar Flare',
  'rose-quartz': 'Rose Quartz',
  'ocean-depths': 'Ocean Depths',
  'cyber-lime': 'Cyber Lime',
  'paper-ink': 'Paper & Ink',
  'high-contrast': 'High Contrast',
}

/** Runtime metadata for a built-in id, or `null` for non-built-in ids. */
export const getBuiltinThemeMeta = (id: string): BuiltinThemeMeta | null => {
  if (id === BUILTIN_VIXL_THEME_META.id) {
    return BUILTIN_VIXL_THEME_META
  }
  if ((RESERVED_CURATED_BUILTIN_THEME_IDS as readonly string[]).includes(id)) {
    return {
      id,
      name: CURATED_BUILTIN_NAMES[id as ReservedCuratedBuiltinThemeId] ?? id,
      readOnlyBuiltIn: true,
      usesCssDefaults: false,
    }
  }
  return null
}

/** Every bundled theme (default first, then curated), in display order. */
export const BUNDLED_THEMES: readonly VixlThemeDefinition[] = [
  builtInVixlTheme,
  ...CURATED_BUNDLED_THEMES,
]

/** Look up a bundled built-in definition by id (default or curated). */
export const getBuiltinThemeDefinition = (id: string): VixlThemeDefinition | null =>
  BUNDLED_THEMES.find((theme) => theme.id === id) ?? null
