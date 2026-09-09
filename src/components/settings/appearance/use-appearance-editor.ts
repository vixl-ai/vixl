import { computed, ref } from 'vue'
import {
  clampFontSize,
  cloneThemeDefinition,
  isValidHexColor,
  builtInVariant,
} from './appearance-ui'
import { normalizeCanvas } from '@/utils/appearance/canvas-presets'
import { sanitizeGlass } from './appearance-glass-ui'
import {
  BUILTIN_VIXL_THEME_ID,
  THEME_ICON_PACKS,
  VIXL_THEME_FORMAT_VERSION,
} from '@/types/appearance/theme'
import type {
  VixlThemeCanvas,
  VixlThemeDefinition,
  VixlThemeGlass,
  VixlThemeIconAppearance,
  VixlThemeSemanticTokens,
  VixlThemeTypography,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'
import {
  THEME_ICON_SIZE_SCALE_MAX,
  THEME_ICON_SIZE_SCALE_MIN,
  THEME_ICON_WEIGHT_MAX,
  THEME_ICON_WEIGHT_MIN,
  THEME_NAME_MAX_LENGTH,
} from '@/schemas/appearance/theme'

export type AppearanceEditorMode = 'create' | 'edit' | 'duplicate' | null

/** Editor sections that support a per-section reset to Vixl defaults. */
export type AppearanceEditorSection = 'colors' | 'typography' | 'background' | 'glass' | 'icons'

export const APPEARANCE_EDITOR_SECTIONS: readonly AppearanceEditorSection[] = [
  'colors',
  'typography',
  'background',
  'glass',
  'icons',
]

const sanitizeName = (name: string): string => {
  const trimmed = name
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed.slice(0, THEME_NAME_MAX_LENGTH)
}

/**
 * Draft state for editing one theme variant. Experimental edits stay in the
 * draft until Apply/Save commits them to the theme library, so typing never
 * writes settings. The draft also feeds the runtime live preview.
 */
export const useAppearanceEditor = () => {
  const draft = ref<VixlThemeDefinition | null>(null)
  const baseline = ref<VixlThemeDefinition | null>(null)
  const editingVariant = ref<VixlThemeVariantKind>('light')
  const mode = ref<AppearanceEditorMode>(null)

  const isEditing = computed(() => draft.value !== null)

  const isDirty = computed(() => {
    if (!draft.value || !baseline.value) {
      return false
    }
    return JSON.stringify(draft.value) !== JSON.stringify(baseline.value)
  })

  /** Draft passes the strict schema validation. */
  const isDraftValid = computed(() => {
    if (!draft.value) {
      return false
    }
    for (const variant of ['light', 'dark'] as const) {
      const variantTheme = draft.value.variants[variant]
      if (!isValidHexColor(variantTheme.colors.background)) {
        return false
      }
      if (!isValidHexColor(variantTheme.colors.foreground)) {
        return false
      }
    }
    return sanitizeName(draft.value.name).length > 0
  })

  const draftVariant = computed(() =>
    draft.value ? draft.value.variants[editingVariant.value] : null,
  )

  const begin = (
    next: VixlThemeDefinition,
    editorMode: Exclude<AppearanceEditorMode, null>,
    variant: VixlThemeVariantKind,
  ): void => {
    baseline.value = cloneThemeDefinition(next)
    draft.value = cloneThemeDefinition(next)
    editingVariant.value = variant
    mode.value = editorMode
  }

  /** Starts a fresh theme derived from an existing theme's current values. */
  const beginCreate = (
    source: VixlThemeDefinition,
    id: string,
    variant: VixlThemeVariantKind = 'light',
  ): void => {
    begin(
      {
        ...cloneThemeDefinition(source),
        id,
        name: 'Untitled theme',
        version: VIXL_THEME_FORMAT_VERSION,
      },
      'create',
      variant,
    )
  }

  /** Edits a saved theme in place. Editing the built-in theme creates a copy. */
  const beginEdit = (
    theme: VixlThemeDefinition,
    idForCopy: string,
    variant: VixlThemeVariantKind = 'light',
  ): void => {
    if (theme.id === BUILTIN_VIXL_THEME_ID) {
      beginCreate(theme, idForCopy, variant)
      return
    }
    begin(theme, 'edit', variant)
  }

  const beginDuplicate = (
    theme: VixlThemeDefinition,
    id: string,
    variant: VixlThemeVariantKind = 'light',
  ): void => {
    const copy = cloneThemeDefinition(theme)
    copy.id = id
    copy.name = `${theme.name} copy`.slice(0, THEME_NAME_MAX_LENGTH)
    copy.version = VIXL_THEME_FORMAT_VERSION
    begin(copy, 'duplicate', variant)
  }

  const cancel = (): void => {
    draft.value = null
    baseline.value = null
    mode.value = null
  }

  const setVariant = (variant: VixlThemeVariantKind): void => {
    editingVariant.value = variant
  }

  const rename = (name: string): void => {
    if (!draft.value) {
      return
    }
    draft.value = { ...draft.value, name: sanitizeName(name) }
  }

  const setToken = (key: keyof VixlThemeSemanticTokens, value: string): void => {
    const variantTheme = draft.value?.variants[editingVariant.value]
    if (!variantTheme) {
      return
    }
    variantTheme.colors = { ...variantTheme.colors, [key]: value.trim() }
  }

  const setTypography = (patch: Partial<VixlThemeTypography>): void => {
    if (!draft.value) {
      return
    }
    const typography = draft.value.variants[editingVariant.value].typography
    draft.value.variants[editingVariant.value].typography = {
      ...typography,
      ...patch,
      uiFontSize:
        patch.uiFontSize !== undefined ? clampFontSize(patch.uiFontSize) : typography.uiFontSize,
      editorFontSize:
        patch.editorFontSize !== undefined
          ? clampFontSize(patch.editorFontSize)
          : typography.editorFontSize,
    }
  }

  const setCanvas = (canvas: VixlThemeCanvas): void => {
    const variantTheme = draft.value?.variants[editingVariant.value]
    if (!variantTheme) {
      return
    }
    // Shared pure normalization: bounded layer count/geometry, safe hex
    // fallback, and stops sorted by ascending position, so the draft always
    // round-trips through the strict v2 schema. The background editor and
    // canonical export use the same helpers.
    variantTheme.canvas = normalizeCanvas(canvas)
  }

  /**
   * Replaces the draft variant's glass configuration. Values are sanitized
   * (clamped, canonical scope order, valid presets) so the draft always
   * round-trips the strict v2 schema.
   */
  const setGlass = (glass: VixlThemeGlass): void => {
    const variantTheme = draft.value?.variants[editingVariant.value]
    if (!variantTheme) {
      return
    }
    variantTheme.glass = sanitizeGlass(glass)
  }

  /**
   * Replaces the draft variant's icon appearance. Values are sanitized
   * (allowlisted pack, clamped weight/scale, `inherit` or safe hex tint) so
   * the draft always round-trips the strict v2 schema.
   */
  const setIcons = (icons: VixlThemeIconAppearance): void => {
    const variantTheme = draft.value?.variants[editingVariant.value]
    if (!variantTheme) {
      return
    }
    const pack = (THEME_ICON_PACKS as readonly string[]).includes(icons.pack)
      ? icons.pack
      : 'lucide'
    const weight = Number.isFinite(icons.weight)
      ? Math.min(
          THEME_ICON_WEIGHT_MAX,
          Math.max(THEME_ICON_WEIGHT_MIN, Math.round(icons.weight * 2) / 2),
        )
      : 2
    const sizeScale = Number.isFinite(icons.sizeScale)
      ? Math.min(
          THEME_ICON_SIZE_SCALE_MAX,
          Math.max(THEME_ICON_SIZE_SCALE_MIN, Math.round(icons.sizeScale * 100) / 100),
        )
      : 1
    const tint =
      icons.tint === 'inherit' || (typeof icons.tint === 'string' && isValidHexColor(icons.tint))
        ? icons.tint
        : 'inherit'
    variantTheme.icons = { pack, weight, sizeScale, tint }
  }

  /** Restores one variant of the draft to the built-in defaults. */
  const resetVariant = (): void => {
    if (!draft.value) {
      return
    }
    const defaults = structuredClone(builtInVariant(editingVariant.value))
    draft.value.variants[editingVariant.value] = defaults
  }

  /**
   * Restores one section (colors, typography, background, glass, or icons) of
   * the editing variant to the built-in Vixl defaults, leaving the rest of the
   * draft untouched. Glass passes through sanitization like live edits.
   */
  const resetSection = (section: AppearanceEditorSection): void => {
    if (!draft.value) {
      return
    }
    const defaults = structuredClone(builtInVariant(editingVariant.value))
    const variantTheme = draft.value.variants[editingVariant.value]
    switch (section) {
      case 'colors':
        variantTheme.colors = defaults.colors
        break
      case 'typography':
        variantTheme.typography = defaults.typography
        break
      case 'background':
        variantTheme.canvas = defaults.canvas
        break
      case 'glass':
        variantTheme.glass = sanitizeGlass(defaults.glass)
        break
      case 'icons':
        variantTheme.icons = defaults.icons
        break
    }
  }

  return {
    draft,
    baseline,
    editingVariant,
    mode,
    isEditing,
    isDirty,
    isDraftValid,
    draftVariant,
    beginCreate,
    beginEdit,
    beginDuplicate,
    begin,
    cancel,
    setVariant,
    rename,
    setToken,
    setTypography,
    setCanvas,
    setGlass,
    setIcons,
    resetVariant,
    resetSection,
  }
}
