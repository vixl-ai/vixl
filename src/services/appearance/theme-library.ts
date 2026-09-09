import {
  THEME_ID_PATTERN,
  THEME_LIBRARY_MAX_SIZE,
  parseThemeDefinition,
} from '@/schemas/appearance/theme'
import { themeDefinitionV1Schema } from '@/schemas/appearance/theme-v1'
import {
  themeFilePayloadSchema,
  themeFilePayloadV1Schema,
  type ThemeFilePayload,
} from '@/schemas/appearance/theme-file'
import type {
  VixlThemeDefinition,
  VixlThemeEditorPalette,
  VixlThemeVariant,
} from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import {
  getBuiltinThemeDefinition,
  isReservedThemeId,
  RESERVED_BUILTIN_THEME_IDS,
} from '@/constants/appearance/built-in-theme-registry'
import { migrateThemeDefinitionV1, migrateThemeFileV1 } from './theme-migration'

/**
 * Helpers for the personal theme library stored in settings under
 * `appearance.themeLibrary` with the active id under
 * `appearance.activeThemeId`. Both keys are personal-only: they are stripped
 * from project overrides so project config cannot embed or replace a user's
 * theme library.
 */

export const isThemeId = (value: unknown): value is string =>
  typeof value === 'string' && THEME_ID_PATTERN.test(value)

const widgetColorDefaults = (
  variant: 'light' | 'dark',
): Pick<
  VixlThemeEditorPalette,
  | 'hoverWidgetBackground'
  | 'hoverWidgetForeground'
  | 'hoverWidgetBorder'
  | 'suggestWidgetBackground'
  | 'suggestWidgetForeground'
  | 'suggestWidgetBorder'
> => builtInVixlTheme.variants[variant].editor

const convertVariant = (
  variant: ThemeFilePayload['variants']['light'],
  typography: ThemeFilePayload['typography'],
  kind: 'light' | 'dark',
): VixlThemeVariant => ({
  colors: { ...variant.tokens },
  canvas: {
    fallback: variant.background.fallback,
    layers: variant.background.layers.map((layer) => structuredClone(layer)),
  },
  glass: { ...variant.glass },
  icons: { ...variant.icons },
  typography: {
    uiFontFamily: typography.uiFontFamily,
    uiFontFallbacks: [...builtInVixlTheme.variants[kind].typography.uiFontFallbacks],
    monoFontFamily: typography.monoFontFamily,
    monoFontFallbacks: [...builtInVixlTheme.variants[kind].typography.monoFontFallbacks],
    uiFontSize: typography.uiFontSize,
    editorFontSize: typography.editorFontSize,
  },
  editor: {
    ...variant.editor,
    ...widgetColorDefaults(kind),
  },
})

/**
 * Convert a validated shareable file payload (`@/schemas/appearance/theme-file`)
 * into the runtime domain definition used by the resolver and CSS runtime.
 * Widget colors and font fallback stacks are filled from the built-in theme
 * because the shareable format does not carry them.
 */
export const themeFilePayloadToThemeDefinition = (
  payload: ThemeFilePayload,
): VixlThemeDefinition => ({
  id: payload.id,
  name: payload.name,
  version: payload.version,
  variants: {
    light: convertVariant(payload.variants.light, payload.typography, 'light'),
    dark: convertVariant(payload.variants.dark, payload.typography, 'dark'),
  },
})

/** Parse one untrusted library entry in any accepted storage shape. */
const parseLibraryEntry = (entry: unknown): VixlThemeDefinition | null => {
  // Canonical v2 domain entries (what the Appearance editor saves).
  const domain = parseThemeDefinition(entry)
  if (domain.success) {
    return domain.data
  }

  // v2 shareable-file shape entries persisted by the import pipeline.
  const file = themeFilePayloadSchema.safeParse(entry)
  if (file.success && !isReservedThemeId(file.data.id)) {
    return themeFilePayloadToThemeDefinition(file.data)
  }

  // v1 domain entries: migrate to v2 instead of dropping them.
  const domainV1 = themeDefinitionV1Schema.safeParse(entry)
  if (domainV1.success) {
    return migrateThemeDefinitionV1(domainV1.data)
  }

  // v1 shareable-file shape entries: migrate to v2, then convert to domain.
  const fileV1 = themeFilePayloadV1Schema.safeParse(entry)
  if (fileV1.success && !isReservedThemeId(fileV1.data.id)) {
    return themeFilePayloadToThemeDefinition(migrateThemeFileV1(fileV1.data))
  }

  return null
}

/**
 * Defensively sanitize an untrusted theme library value: migrate v1 entries,
 * drop invalid or duplicate entries, cap the library size, and keep the
 * original order. Entries invalid in both supported versions are removed
 * rather than failing the whole settings parse.
 */
export const sanitizeThemeLibrary = (raw: unknown): VixlThemeDefinition[] => {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const library: VixlThemeDefinition[] = []

  for (const entry of raw) {
    if (library.length >= THEME_LIBRARY_MAX_SIZE) {
      break
    }
    const theme = parseLibraryEntry(entry)
    if (!theme) {
      continue
    }
    if (seen.has(theme.id)) {
      continue
    }
    seen.add(theme.id)
    library.push(theme)
  }

  return library
}

export const resolveThemeById = (
  library: readonly VixlThemeDefinition[],
  themeId: string | undefined,
): VixlThemeDefinition | null => {
  if (!themeId || themeId === builtInVixlTheme.id) {
    return null
  }
  return library.find((theme) => theme.id === themeId) ?? null
}

/**
 * Resolve the active theme definition from a stored id: a personal library
 * entry first, then a curated bundled theme, else `null` (which the resolver
 * maps to the built-in default).
 */
export const resolveActiveTheme = (
  library: readonly VixlThemeDefinition[],
  activeThemeId: unknown,
): VixlThemeDefinition | null => {
  if (typeof activeThemeId !== 'string' || activeThemeId.length === 0) {
    return null
  }
  if (activeThemeId === builtInVixlTheme.id) {
    return null
  }
  return (
    resolveThemeById(library, activeThemeId) ??
    (isReservedThemeId(activeThemeId) ? getBuiltinThemeDefinition(activeThemeId) : null)
  )
}

/**
 * Resolve the active custom theme definition, falling back to the built-in
 * theme when the stored active id is missing, malformed, or dangling
 * (for example after the active theme was deleted elsewhere).
 */
export const resolveActiveCustomTheme = (
  library: readonly VixlThemeDefinition[],
  activeThemeId: unknown,
): VixlThemeDefinition | null => {
  if (typeof activeThemeId !== 'string' || activeThemeId.length === 0) {
    return null
  }
  return resolveThemeById(library, activeThemeId)
}

/** Normalize a user-facing theme name into a valid theme id slug. */
export const slugifyThemeName = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'custom-theme'
}

/**
 * Return a collision-safe id for a theme being added to the library.
 * The display name is preserved; only the id is rewritten on collision.
 * Every reserved built-in id (the default plus the curated bundled themes)
 * is treated as taken.
 */
export const resolveCollisionSafeThemeId = (
  desiredId: string,
  existingIds: readonly string[],
): string => {
  const taken = new Set(existingIds)
  for (const reservedId of RESERVED_BUILTIN_THEME_IDS) {
    taken.add(reservedId)
  }
  if (!taken.has(desiredId)) {
    return desiredId
  }
  const base = desiredId.slice(0, 56).replace(/-+$/g, '')
  if (base !== desiredId && !taken.has(base)) {
    return base
  }

  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!taken.has(candidate)) {
      return candidate
    }
  }

  return `${base}-${Date.now().toString(36)}`
}

/**
 * Clean stored appearance theme state: migrate/drop invalid library entries,
 * cap the library, and remove a dangling active id so the resolver falls back
 * to a bundled theme. Returns the cleaned values to write back into settings.
 */
export const cleanAppearanceThemeState = (
  rawLibrary: unknown,
  rawActiveId: unknown,
): { themeLibrary: VixlThemeDefinition[]; activeThemeId: string | undefined } => {
  const themeLibrary = sanitizeThemeLibrary(rawLibrary)
  // Curated built-in active ids are valid state and must survive cleaning.
  const activeId = resolveActiveTheme(themeLibrary, rawActiveId)
  return {
    themeLibrary,
    activeThemeId: activeId?.id,
  }
}
