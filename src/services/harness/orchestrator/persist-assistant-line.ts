import { persistLine } from './persistence'
import { nowIso } from './helpers'

type PersistAssistantLineInput = {
  projectSlug: string
  chatId: string
  assistantId: string
  reasoningText: string
  reasoningSeconds: number
  trailingText: string
  aborted?: boolean
}

export default async (input: PersistAssistantLineInput): Promise<void> => {
  const duration = input.reasoningSeconds
  const reasoningPart = input.reasoningText
    ? {
        type: 'reasoning' as const,
        text: input.reasoningText,
        ...(duration > 0 ? { duration } : {}),
      }
    : null
  if (!reasoningPart && !input.trailingText) {
    return
  }
  await persistLine(input.projectSlug, input.chatId, {
    id: input.assistantId,
    role: 'assistant',
    parts: [
      ...(reasoningPart ? [reasoningPart] : []),
      ...(input.trailingText ? [{ type: 'text' as const, text: input.trailingText }] : []),
    ],
    createdAt: nowIso(),
    ...(input.aborted ? { aborted: true } : {}),
  })
}
