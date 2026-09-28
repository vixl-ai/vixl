import type { DynamicToolUIPart, UIMessage } from 'ai'

const INTERRUPTED_ERROR = 'Interrupted by provider error'

const isStoppedOutput = (output: unknown): boolean =>
  Boolean(
    output &&
      typeof output === 'object' &&
      !Array.isArray(output) &&
      (output as { stopped?: unknown }).stopped === true,
  )

const prepareToolPart = (part: DynamicToolUIPart): DynamicToolUIPart | null => {
  if (part.input === undefined) {
    return null
  }
  if (part.state === 'output-available' && isStoppedOutput(part.output)) {
    return {
      type: 'dynamic-tool',
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      state: 'output-error',
      input: part.input,
      errorText: INTERRUPTED_ERROR,
    }
  }
  return part
}

export default (messages: UIMessage[]): UIMessage[] => {
  const last = messages.at(-1)
  if (!last || last.role !== 'assistant') {
    return messages
  }

  const parts: UIMessage['parts'] = []
  for (const part of last.parts) {
    if (part.type !== 'dynamic-tool') {
      parts.push(part)
      continue
    }
    const next = prepareToolPart(part)
    if (next) {
      parts.push(next)
    }
  }

  return [...messages.slice(0, -1), { ...last, parts }]
}
