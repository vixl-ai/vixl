/**
 * Pure WCAG color-contrast helpers shared by the appearance domain, the
 * settings UI, and the bundled-theme registry (constants layer). Hex colors
 * only — the same safe forms the strict theme schema accepts.
 */

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

export const isValidHexColor = (value: string): boolean => HEX_COLOR_PATTERN.test(value.trim())

const hexToRgb = (hex: string): [number, number, number] => {
  const value = hex.trim()
  const channel = (raw: string): number => {
    const parsed = Number.parseInt(raw, 16)
    return Number.isFinite(parsed) ? parsed : 0
  }
  if (value.length === 4) {
    return [
      channel(`${value[1] ?? '0'}${value[1] ?? '0'}`),
      channel(`${value[2] ?? '0'}${value[2] ?? '0'}`),
      channel(`${value[3] ?? '0'}${value[3] ?? '0'}`),
    ]
  }
  return [channel(value.slice(1, 3)), channel(value.slice(3, 5)), channel(value.slice(5, 7))]
}

const relativeLuminance = (hex: string): number => {
  const [r, g, b] = hexToRgb(hex).map((channel) => {
    const scaled = channel / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** WCAG contrast ratio between two colors (1 to 21). */
export const contrastRatio = (a: string, b: string): number => {
  const la = relativeLuminance(a.trim())
  const lb = relativeLuminance(b.trim())
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Linear mix of two hex colors; `ratio` is the weight of the first color. */
export const mixHexColors = (a: string, b: string, ratio: number): string => {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const clamp01 = (value: number): number => Math.min(255, Math.max(0, Math.round(value)))
  const channel = (c1: number, c2: number): number => clamp01(c1 * ratio + c2 * (1 - ratio))
  const toHex = (value: number): string => value.toString(16).padStart(2, '0')
  return `#${toHex(channel(r1, r2))}${toHex(channel(g1, g2))}${toHex(channel(b1, b2))}`
}

/** Minimum WCAG contrast for normal text. */
export const WCAG_AA_CONTRAST = 4.5

/**
 * Pick the foreground with the better contrast against `surface`, preferring
 * a candidate that clears WCAG AA (4.5:1). Used by the bundled-theme registry
 * to derive `*Foreground` tokens that always stay readable on their surface.
 */
export const readableForegroundOn = (
  surface: string,
  candidates: readonly [string, string],
): string => {
  const [first, second] = candidates
  const firstRatio = contrastRatio(first, surface)
  const secondRatio = contrastRatio(second, surface)
  if (firstRatio >= WCAG_AA_CONTRAST) {
    return first
  }
  if (secondRatio >= WCAG_AA_CONTRAST) {
    return second
  }
  return firstRatio >= secondRatio ? first : second
}
