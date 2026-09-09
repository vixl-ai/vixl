import { inject, provide, shallowRef, type InjectionKey, type Ref } from 'vue'
import type { VixlThemeIconAppearance } from '@/types/appearance/theme'

/**
 * Runtime icon appearance state.
 *
 * The appearance runtime (`use-appearance.ts`) publishes the effective
 * theme's icon appearance here; `AppIcon` reads it per render. UI previews
 * can scope a draft appearance with `provideIconAppearance` so unsaved icon
 * edits render live without touching the global runtime.
 */

export const DEFAULT_ICON_APPEARANCE: VixlThemeIconAppearance = {
  pack: 'lucide',
  weight: 2,
  sizeScale: 1,
  tint: 'inherit',
}

const sharedAppearance = shallowRef<VixlThemeIconAppearance>(DEFAULT_ICON_APPEARANCE)

const ICON_APPEARANCE_KEY: InjectionKey<Ref<VixlThemeIconAppearance>> =
  Symbol('vixl-icon-appearance')

/** Publish the effective icon appearance to the shared runtime state. */
export const setSharedIconAppearance = (appearance: VixlThemeIconAppearance): void => {
  sharedAppearance.value = appearance
}

/**
 * Scope a draft icon appearance to a component subtree (settings previews).
 * Must be called during component setup.
 */
export const provideIconAppearance = (source: Ref<VixlThemeIconAppearance>): void => {
  provide(ICON_APPEARANCE_KEY, source)
}

/** Icon appearance in effect for the calling component. */
export const useIconAppearance = (): Ref<VixlThemeIconAppearance> =>
  inject(ICON_APPEARANCE_KEY, null) ?? sharedAppearance
