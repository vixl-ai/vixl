import type { ModelMessage } from 'ai'
import { parseImageDimensions } from '@/utils/image-dimensions'
import { redactImageDataURLs } from '@/utils/redact-image-data-urls'
import {
  imageSourceString,
  isImagePartLike,
} from './estimate-model-message-tokens'

type UnknownRecord = Record<string, unknown>

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null

const imageLabel = (part: UnknownRecord): string => {
  const dims = parseImageDimensions(imageSourceString(part.data ?? part.image ?? part.url) ?? '')
  const name =
    typeof part.filename === 'string' && part.filename ? part.filename : 'image'
  return dims
    ? `[image ${name} ${dims.width}x${dims.height}]`
    : `[image ${name}]`
}

const describePart = (part: unknown): unknown => {
  if (!isRecord(part)) {
    return part
  }
  if (isImagePartLike(part)) {
    return { type: 'text', text: imageLabel(part) }
  }
  if (part.type === 'file' || part.type === 'reasoning-file') {
    const name =
      typeof part.filename === 'string' && part.filename ? part.filename : 'file'
    return { type: 'text', text: `[file ${name} omitted]` }
  }
  return part
}

export default (message: ModelMessage): string => {
  let serialized: string
  if (typeof message.content === 'string') {
    serialized = message.content
  } else {
    try {
      serialized = JSON.stringify(
        Array.isArray(message.content)
          ? message.content.map(describePart)
          : message.content,
      )
    } catch {
      return ''
    }
  }
  return redactImageDataURLs(serialized)
}
