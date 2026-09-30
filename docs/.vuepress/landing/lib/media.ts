const LANDING_MEDIA = '/media/landing'

// Downscaled copies live next to each 2400w original as `<name>-<width>w.webp`.
const VARIANT_WIDTHS = [640, 768, 960, 1280, 1600] as const
const ORIGINAL_WIDTH = 2400

export function landingImageSrc(name: string): string {
  return `${LANDING_MEDIA}/${name}-1280w.webp`
}

export function landingImageSrcset(name: string): string {
  return [
    ...VARIANT_WIDTHS.map((w) => `${LANDING_MEDIA}/${name}-${w}w.webp ${w}w`),
    `${LANDING_MEDIA}/${name}.webp ${ORIGINAL_WIDTH}w`,
  ].join(', ')
}

// Must track .vx-container padding (20 / 32 at sm / 40 at lg) and max widths.
export const HERO_IMAGE_SIZES =
  '(min-width: 1200px) 1120px, (min-width: 1024px) calc(100vw - 80px), (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)'

export const FEATURE_IMAGE_SIZES =
  '(min-width: 1440px) 900px, (min-width: 1024px) 62vw, (min-width: 640px) calc(100vw - 64px), calc(100vw - 40px)'
