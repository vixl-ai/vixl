import type { Component } from 'vue'
import type { VixlThemeIconPack } from '@/types/appearance/theme'
import type { AppIconName } from './icon-names'
import { lucideIconAdapter } from './adapters/lucide'
import { phosphorIconAdapter } from './adapters/phosphor'
import { tablerIconAdapter } from './adapters/tabler'
import type { IconPackAdapter } from './adapters/types'

/**
 * Icon pack resolution.
 *
 * Packs are bundled and allowlisted; the active pack id comes from the theme
 * (never from theme files' data beyond the allowlisted id), so no component
 * names, SVG data, or remote assets can enter through appearance settings.
 */
export const ICON_PACK_ADAPTERS: Record<VixlThemeIconPack, IconPackAdapter> = {
  lucide: lucideIconAdapter,
  tabler: tablerIconAdapter,
  phosphor: phosphorIconAdapter,
}

export const getIconPackAdapter = (pack: VixlThemeIconPack | string): IconPackAdapter => {
  if (pack === 'tabler' || pack === 'phosphor') {
    return ICON_PACK_ADAPTERS[pack]
  }
  return ICON_PACK_ADAPTERS.lucide
}

/** Last-resort fallback glyph (question mark) for out-of-contract names. */
const FALLBACK_ICON_NAME: AppIconName = 'circle-help'

/**
 * Resolve a semantic icon name to a component in the given pack. The
 * contract test guarantees every semantic name exists in every adapter; the
 * fallback keeps malformed data from crashing the UI in development.
 */
export const resolveIconComponent = (
  name: AppIconName,
  pack: VixlThemeIconPack | string,
): Component => {
  const adapter = getIconPackAdapter(pack)
  return adapter.components[name] ?? ICON_PACK_ADAPTERS.lucide.components[FALLBACK_ICON_NAME]
}
