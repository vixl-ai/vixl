import {
  parseImageDimensions,
  parseImageDimensionsFromBytes,
  type ImageDimensions,
} from './image-dimensions'

// Anthropic vision pricing (platform.claude.com/docs/en/build-with-claude/vision):
// an image costs ceil(width/28) x ceil(height/28) tokens, capped for high-res
// inputs. OpenAI/Gemini are the same order of magnitude or cheaper, so this
// estimate never under-counts them.
const PATCH_PX = 28
export const MAX_IMAGE_TOKENS = 4_784
export const UNKNOWN_IMAGE_TOKENS = 1_600

const CACHE_MAX_ENTRIES = 64
const cache = new Map<string, number>()

const dimensionsToTokens = (dims: ImageDimensions): number =>
  Math.min(
    Math.ceil(dims.width / PATCH_PX) * Math.ceil(dims.height / PATCH_PX),
    MAX_IMAGE_TOKENS,
  )

const cached = (key: string, compute: () => number): number => {
  const hit = cache.get(key)
  if (hit !== undefined) {
    return hit
  }
  const value = compute()
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.clear()
  }
  cache.set(key, value)
  return value
}

// Keys on length plus header prefix: cheap, and collisions only ever merge
// images with identical framing bytes and size (estimation, not identity).
const sourceCacheKey = (source: string): string =>
  `${source.length}:${source.slice(0, 64)}`

export const estimateImageTokensFromBytes = (bytes: Uint8Array): number => {
  const dims = parseImageDimensionsFromBytes(bytes)
  return dims ? dimensionsToTokens(dims) : UNKNOWN_IMAGE_TOKENS
}

export const estimateImageTokensFromSource = (source: string): number => {
  if (!source) {
    return UNKNOWN_IMAGE_TOKENS
  }
  return cached(sourceCacheKey(source), () => {
    const dims = parseImageDimensions(source)
    return dims ? dimensionsToTokens(dims) : UNKNOWN_IMAGE_TOKENS
  })
}
