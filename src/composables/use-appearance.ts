import { useColorMode } from '@vueuse/core'
import { computed, getCurrentScope, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue'
import useVixlConfig from '@/composables/use-vixl-config'
import { setSharedIconAppearance } from '@/icons/icon-appearance'
import { sanitizeThemeLibrary, resolveActiveTheme } from '@/services/appearance/theme-library'
import {
  applyEffectiveAppearance,
  clearAppearanceAttributes,
  clearAppearanceVariables,
} from '@/utils/appearance/appearance-css'
import {
  getEffectiveAppearanceSignature,
  resolveEffectiveAppearance,
  VIXL_APPEARANCE_CHANGE_EVENT,
  type AppearanceChangeEventDetail,
  type AppearancePreviewDraft,
  type EffectiveAppearance,
  type VixlColorMode,
} from '@/utils/appearance/resolve-effective-appearance'

/**
 * Appearance runtime.
 *
 * Central controller that:
 * - keeps VueUse `useColorMode` driven by the `appearance.theme` setting
 *   (Vixl settings stay authoritative; the localStorage mode key is only a
 *   cross-instance cache that is re-synced on every hydration),
 * - resolves the effective appearance from the built-in theme, the personal
 *   theme library, the light/dark variant, and an optional preview draft,
 * - applies only allowlisted CSS variables, the canvas background, and
 *   typography to `document.documentElement`,
 * - exposes begin/update/commit/cancel preview lifecycle operations,
 * - clears stale variables/preview state when returning to the built-in
 *   theme, on reset, or when the previewing scope unmounts,
 * - emits one normalized `vixl:appearance-change` window event for non-CSS
 *   consumers (Monaco/Shiki theme adapters).
 */

type ColorModeState = ReturnType<typeof useColorMode>

// Singleton color-mode state: created on the first composable call (App.vue
// setup) and reused by every later caller so all VueUse color-mode consumers
// share one store.
let colorModeState: ColorModeState | null = null

// Shared runtime state (module scope) so the settings editor can drive the
// preview lifecycle from a different component than App.vue.
const previewDraft = shallowRef<AppearancePreviewDraft | null>(null)
const revision = ref(0)
let lastAppliedSignature: string | null = null

const ensureColorModeState = (): ColorModeState => {
  if (!colorModeState) {
    colorModeState = useColorMode()
  }
  return colorModeState
}

const emitAppearanceChange = (
  appearance: EffectiveAppearance,
  nextRevision: number,
  previewing: boolean,
): void => {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') {
    return
  }
  const detail: AppearanceChangeEventDetail = {
    themeId: appearance.themeId,
    themeName: appearance.themeName,
    readOnlyBuiltIn: appearance.readOnlyBuiltIn,
    usesCssDefaults: appearance.usesCssDefaults,
    colorMode: appearance.colorMode,
    variant: appearance.variant,
    revision: nextRevision,
    previewing,
    typography: appearance.typography,
    editor: appearance.editor,
  }
  window.dispatchEvent(
    new CustomEvent<AppearanceChangeEventDetail>(VIXL_APPEARANCE_CHANGE_EVENT, { detail }),
  )
}

export default () => {
  const config = useVixlConfig()
  const mode = ensureColorModeState()

  const hydrated = config.hydrated

  const colorMode = computed<VixlColorMode>(() => {
    const raw = config.effectiveSettings.value['appearance.theme']
    return raw === 'light' || raw === 'dark' ? raw : 'system'
  })

  // Personal theme library; defensively sanitized against malformed state.
  const themeLibrary = computed(() =>
    sanitizeThemeLibrary(config.effectiveSettings.value['appearance.themeLibrary']),
  )

  // Active theme: personal library entry first, then a curated bundled
  // theme; null resolves to the built-in default.
  const activeTheme = computed(() =>
    resolveActiveTheme(
      themeLibrary.value,
      config.effectiveSettings.value['appearance.activeThemeId'],
    ),
  )

  const effectiveAppearance = computed<EffectiveAppearance>(() =>
    resolveEffectiveAppearance({
      colorMode: colorMode.value,
      systemDark: mode.system.value === 'dark',
      theme: activeTheme.value,
      preview: previewDraft.value,
    }),
  )

  const isPreviewing = computed(() => previewDraft.value !== null)

  const syncColorMode = (): void => {
    const previewVariant = previewDraft.value?.variant
    if (previewVariant) {
      mode.value = previewVariant
      return
    }
    mode.value = colorMode.value === 'system' ? 'auto' : colorMode.value
  }

  /** Legacy alias kept for existing callers: sync VueUse from settings. */
  const syncTheme = (): void => {
    syncColorMode()
  }

  const applyAppearance = (): void => {
    if (typeof document === 'undefined') {
      return
    }
    const appearance = effectiveAppearance.value
    const previewing = previewDraft.value !== null
    const signature = getEffectiveAppearanceSignature(appearance, { previewing })
    if (signature === lastAppliedSignature) {
      return
    }
    lastAppliedSignature = signature
    revision.value += 1

    const root = document.documentElement
    applyEffectiveAppearance(root, appearance, {
      revision: revision.value,
      previewing,
    })

    syncColorMode()
    emitAppearanceChange(appearance, revision.value, previewing)
  }

  const beginPreview = (draft: AppearancePreviewDraft): void => {
    previewDraft.value = draft
    // If the previewing scope unmounts (settings editor closed), drop the
    // draft so stale preview state never outlives the editor.
    if (getCurrentScope()) {
      onScopeDispose(() => {
        if (previewDraft.value === draft) {
          previewDraft.value = null
        }
      })
    }
  }

  const updatePreview = (draft: AppearancePreviewDraft): void => {
    previewDraft.value = draft
  }

  /**
   * End the preview after the caller persisted the draft to settings; the
   * watcher re-applies the now-authoritative appearance.
   */
  const commitPreview = (): void => {
    previewDraft.value = null
  }

  /** End the preview without persisting; the watcher restores the saved look. */
  const cancelPreview = (): void => {
    previewDraft.value = null
  }

  /**
   * Full reset: drop preview state, clear every runtime variable and
   * attribute, and re-apply the resolved appearance from settings.
   */
  const resetAppearanceRuntime = (): void => {
    previewDraft.value = null
    lastAppliedSignature = null
    if (typeof document !== 'undefined') {
      clearAppearanceVariables(document.documentElement)
      clearAppearanceAttributes(document.documentElement)
    }
    applyAppearance()
  }

  watch(
    [effectiveAppearance, hydrated],
    () => {
      if (hydrated.value || previewDraft.value) {
        applyAppearance()
      }
    },
    { deep: true },
  )

  // Publish the effective icon appearance (pack, weight, size scale, tint) to
  // the shared icon runtime consumed by AppIcon across the app.
  watch(
    () => effectiveAppearance.value.icons,
    (icons) => {
      setSharedIconAppearance(icons)
    },
    { immediate: true, deep: true },
  )

  onMounted(() => {
    if (hydrated.value) {
      applyAppearance()
    }
  })

  return {
    syncTheme,
    effectiveAppearance,
    isPreviewing,
    beginPreview,
    updatePreview,
    commitPreview,
    cancelPreview,
    resetAppearanceRuntime,
  }
}
