import type {
  ModelMessage,
  ToolCallPart,
  ToolContent,
  ToolResultPart,
} from 'ai'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import modelMessageText from './model-message-text'

const CHARS_PER_TOKEN = 4
const TRUNCATION_SUFFIX = '\n[truncated for compaction]'

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
  const serialized = JSON.stringify(message)
  if (estimateTextTokens(serialized) <= maxTokens) {
    return message
  }

  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN)
  const raw = modelMessageText(message)
  const overhead = Math.max(0, serialized.length - raw.length)
  const contentChars = Math.max(0, maxChars - overhead)

  if (message.role === 'system') {
    return { ...message, content: clip(message.content, contentChars) }
  }

  if (message.role === 'tool') {
    return {
      ...message,
      content: truncateToolContent(message.content, contentChars),
    }
  }

  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return { ...message, content: clip(message.content, contentChars) }
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type === 'text') {
          return { ...part, text: clip(part.text, contentChars) }
        }
        return part
      }),
    }
  }

  if (typeof message.content === 'string') {
    return { ...message, content: clip(message.content, contentChars) }
  }

  return {
    ...message,
    content: message.content.map((part) => {
      if (part.type === 'text') {
        return { ...part, text: clip(part.text, contentChars) }
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
