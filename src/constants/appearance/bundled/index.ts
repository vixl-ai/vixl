import { nordicFrostTheme } from './nordic-frost'
import { oceanDepthsTheme } from './ocean-depths'
import { paperInkTheme } from './paper-ink'
import { roseQuartzTheme } from './rose-quartz'
import { solarFlareTheme } from './solar-flare'
import type { VixlThemeDefinition } from '@/types/appearance/theme'
import { midnightAuroraTheme } from './midnight-aurora'
import { cyberLimeTheme } from './cyber-lime'
import { highContrastTheme } from './high-contrast'

/**
 * Curated bundled themes, in gallery display order.
 *
 * Definitions are complete v2 themes: full light/dark semantic colors,
 * editor palettes, layered canvases, glass configuration, and icon
 * appearance. They are immutable, never stored in the personal theme
 * library, and never consume its size cap.
 */
export const CURATED_BUNDLED_THEMES: readonly VixlThemeDefinition[] = [
  midnightAuroraTheme,
  nordicFrostTheme,
  solarFlareTheme,
  roseQuartzTheme,
  oceanDepthsTheme,
  cyberLimeTheme,
  paperInkTheme,
  highContrastTheme,
]
