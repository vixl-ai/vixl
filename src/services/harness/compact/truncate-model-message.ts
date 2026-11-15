import type {
  ModelMessage,
  ToolCallPart,
  ToolContent,
  ToolResultPart,
} from 'ai'
import { redactImageDataURLs } from '@/utils/redact-image-data-urls'
import estimateModelMessageTokens, {
  isImagePartLike,
} from './estimate-model-message-tokens'
import modelMessageText from './model-message-text'

const CHARS_PER_TOKEN = 4
const TRUNCATION_SUFFIX = '\n[truncated for compaction]'
const FILE_OMITTED_PLACEHOLDER = '[image omitted by compaction]'

const omittedFilePart = (): { type: 'text'; text: string } => ({
  type: 'text',
  text: FILE_OMITTED_PLACEHOLDER,
})

type OmitOptions = { keepImages?: boolean }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const omitToolImageOutput = (part: ToolResultPart): ToolResultPart => {
  if (part.output.type === 'content') {
    let changed = false
    const value = part.output.value.map((item) => {
      if (isRecord(item) && isImagePartLike(item)) {
        changed = true
        return omittedFilePart()
      }
      return item
    })
    return changed
      ? { ...part, output: { ...part.output, value } }
      : part
  }
  if (
    (part.output.type === 'text' || part.output.type === 'error-text') &&
    part.output.value.includes('data:image')
  ) {
    return {
      ...part,
      output: {
        ...part.output,
        value: redactImageDataURLs(part.output.value, () => FILE_OMITTED_PLACEHOLDER),
      },
    }
  }
  return part
}

const omitToolContentParts = (content: ToolContent): ToolContent => {
  let changed = false
  const next = content.map((part) => {
    if (part.type !== 'tool-result') {
      return part
    }
    const omitted = omitToolImageOutput(part)
    if (omitted !== part) {
      changed = true
    }
    return omitted
  })
  return changed ? next : content
}

export const omitCompactFileParts = (
  message: ModelMessage,
  options: OmitOptions = {},
): ModelMessage => {
  if (typeof message.content === 'string') {
    return message
  }
  const keepImages = options.keepImages === true

  if (message.role === 'user') {
    let changed = false
    const content = message.content.map((part) => {
      if (part.type !== 'file' && part.type !== 'image') {
        return part
      }
      if (keepImages && isImagePartLike(part)) {
        return part
      }
      changed = true
      return omittedFilePart()
    })
    return changed ? { ...message, content } : message
  }

  if (message.role === 'assistant') {
    let changed = false
    const content = message.content.map((part) => {
      if (part.type !== 'file' && part.type !== 'reasoning-file') {
        return part
      }
      if (keepImages && isImagePartLike(part)) {
        return part
      }
      changed = true
      return omittedFilePart()
    })
    return changed ? { ...message, content } : message
  }

  if (message.role === 'tool') {
    const content = omitToolContentParts(message.content)
    return content === message.content ? message : { ...message, content }
  }

  return message
}

const clip = (value: string, maxChars: number): string => {
  if (value.length <= maxChars) {
    return value
  }
  const sliceLen = Math.max(0, maxChars - TRUNCATION_SUFFIX.length)
  return `${value.slice(0, sliceLen)}${TRUNCATION_SUFFIX}`
}

const truncateOutput = (
  output: ToolResultPart['output'],
  maxChars: number,
): ToolResultPart['output'] => {
  if (output.type === 'text') {
    return { type: 'text', value: clip(output.value, maxChars) }
  }
  return { type: 'text', value: clip(JSON.stringify(output), maxChars) }
}

const truncateToolResult = (
  part: ToolResultPart,
  maxChars: number,
): ToolResultPart => ({
  ...part,
  output: truncateOutput(part.output, maxChars),
})

const truncateToolCall = (
  part: ToolCallPart,
  maxChars: number,
): ToolCallPart => {
  const inputRaw = JSON.stringify(part.input ?? {})
  if (inputRaw.length <= maxChars) {
    return part
  }
  return { ...part, input: { truncated: clip(inputRaw, maxChars) } }
}

const truncateToolContent = (
  content: ToolContent,
  maxChars: number,
): ToolContent =>
  content.map((part) => {
    if (part.type === 'tool-result') {
      return truncateToolResult(part, maxChars)
    }
    return part
  })

export default (message: ModelMessage, maxTokens: number): ModelMessage => {
  const next = omitCompactFileParts(message)
  const serialized = JSON.stringify(next)
  if (estimateModelMessageTokens(next) <= maxTokens) {
    return next
  }

  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN)
  const raw = modelMessageText(next)
  const overhead = Math.max(0, serialized.length - raw.length)
  const contentChars = Math.max(0, maxChars - overhead)

  if (next.role === 'system') {
    return { ...next, content: clip(next.content, contentChars) }
  }

  if (next.role === 'tool') {
    return {
      ...next,
      content: truncateToolContent(next.content, contentChars),
    }
  }

  if (next.role === 'user') {
    if (typeof next.content === 'string') {
      return { ...next, content: clip(next.content, contentChars) }
    }
    return {
      ...next,
      content: next.content.map((part) => {
        if (part.type === 'text') {
          return { ...part, text: clip(part.text, contentChars) }
        }
        if (part.type === 'file' || part.type === 'image') {
          return omittedFilePart()
        }
        return part
      }),
    }
  }

  if (typeof next.content === 'string') {
    return { ...next, content: clip(next.content, contentChars) }
  }

  return {
    ...next,
    content: next.content.map((part) => {
      if (part.type === 'text') {
        return { ...part, text: clip(part.text, contentChars) }
      }
      if (part.type === 'file' || part.type === 'reasoning-file') {
        return omittedFilePart()
      }
      if (part.type === 'tool-result') {
        return truncateToolResult(part, contentChars)
      }
      if (part.type === 'tool-call') {
        return truncateToolCall(part, contentChars)
      }
      return part
    }),
  }
}
