import type { ModelMessage } from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import {
  estimateImageTokensFromBytes,
  estimateImageTokensFromSource,
} from '@/utils/estimate-image-tokens'
import { createImageDataURLMatcher } from '@/utils/redact-image-data-urls'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null

export const mediaTypeIsImage = (mediaType: unknown): boolean =>
  typeof mediaType === 'string' && mediaType.toLowerCase().startsWith('image')

/** Matches model `file`/`image` parts and UI file parts carrying image data. */
export const isImagePartLike = (part: object): boolean => {
  const candidate = part as { type?: unknown; mediaType?: unknown }
  if (candidate.type === 'image') {
    return true
  }
  if (candidate.type === 'file' || candidate.type === 'reasoning-file') {
    return mediaTypeIsImage(candidate.mediaType)
  }
  return false
}

const binaryBytes = (value: unknown): Uint8Array | null => {
  if (value instanceof Uint8Array) {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value)
  }
  return null
}

const isBinaryLike = (value: unknown): boolean =>
  value instanceof Uint8Array || value instanceof ArrayBuffer

/**
 * Cost an image source in any AI SDK shape: bare base64 string, data URL,
 * tagged `{type:'data'|'url'|'reference'|'text'}`, binary bytes, or a remote
 * URL object (unknown cost, still bounded).
 */
export const estimateImageSourceTokens = (value: unknown): number => {
  if (typeof value === 'string') {
    return estimateImageTokensFromSource(value)
  }
  if (isBinaryLike(value)) {
    return estimateImageTokensFromBytes(binaryBytes(value) as Uint8Array)
  }
  if (isRecord(value) && !(value instanceof URL)) {
    if (value.type === 'data') {
      return estimateImageSourceTokens(value.data)
    }
    if (value.type === 'url') {
      return estimateImageSourceTokens(value.url)
    }
    if (value.type === 'text') {
      return estimateImageSourceTokens(value.text)
    }
  }
  return estimateImageTokensFromSource('')
}

/** Extracts a base64/data-URL string from an image source, else null. */
export const imageSourceString = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value
  }
  if (isRecord(value) && !(value instanceof URL) && !isBinaryLike(value)) {
    if (value.type === 'data' || value.type === 'text') {
      return imageSourceString(value.data ?? value.text)
    }
    if (value.type === 'url') {
      return imageSourceString(value.url)
    }
  }
  return null
}

const estimateImagePartTokens = (part: UnknownRecord): number =>
  estimateImageSourceTokens(part.type === 'image' ? part.image : (part.data ?? part.url))

/** Text that may embed base64 image data URLs (serialized tool results). */
export const estimateStringValueTokens = (text: string): number => {
  if (!text.includes('data:image')) {
    return estimateTextTokens(text)
  }
  let tokens = 0
  let last = 0
  const matcher = createImageDataURLMatcher()
  for (const match of text.matchAll(matcher)) {
    const index = match.index ?? 0
    tokens += estimateTextTokens(text.slice(last, index))
    tokens += estimateImageTokensFromSource(match[0])
    last = index + match[0].length
  }
  return tokens + estimateTextTokens(text.slice(last))
}

const estimateUnknownValueTokens = (value: unknown): number => {
  if (typeof value === 'string') {
    return estimateStringValueTokens(value)
  }
  if (value === null || value === undefined) {
    return 0
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return estimateTextTokens(String(value))
  }
  if (value instanceof URL) {
    return estimateTextTokens(value.toString())
  }
  if (isBinaryLike(value)) {
    return estimateImageTokensFromBytes(binaryBytes(value) as Uint8Array)
  }
  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + estimateUnknownValueTokens(item), 0)
  }
  if (isRecord(value)) {
    if (isImagePartLike(value)) {
      return estimateImagePartTokens(value)
    }
    let tokens = 0
    for (const [key, nested] of Object.entries(value)) {
      tokens += estimateTextTokens(key)
      tokens += estimateUnknownValueTokens(nested)
    }
    return tokens
  }
  return estimateTextTokens(String(value))
}

export const estimateModelMessageTokens = (message: ModelMessage): number =>
  estimateUnknownValueTokens(message)

export default estimateModelMessageTokens

const contentHasImagePart = (content: unknown): boolean => {
  if (!Array.isArray(content)) {
    return false
  }
  return content.some((part) => {
    if (!isRecord(part) || isBinaryLike(part)) {
      return false
    }
    if (isImagePartLike(part)) {
      return true
    }
    if (part.type === 'tool-result' && isRecord(part.output)) {
      return contentHasImagePart(part.output.value)
    }
    return false
  })
}

export const messageHasImagePart = (message: ModelMessage): boolean =>
  contentHasImagePart(message.content)
