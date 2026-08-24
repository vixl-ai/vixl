import type { UIMessage } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  buildTranscript,
  compactBudgets,
  summarizeTranscript,
} from '@/services/harness/compact'
import { appendChatLine, updateChatMeta } from '@/services/vixl/vixl-tauri'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import formatUnknownError from '@/utils/format-unknown-error'

export type CompactSessionInput = {
  projectSlug: string
  chatId: string
  projectRoot: string
  settings: VixlSettings
  messages: UIMessage[]
  focus?: string
  signal?: AbortSignal
  frozenSystem?: string
  chatModel?: string
  /** Prefer AgentTurn.id when compacting mid-turn; else session sentinel. */
  turnId?: string
  onEvent?: (event: HarnessEvent) => void
}

export type CompactSessionResult = {
  summary: string
  includeFromCreatedAt: string
  checkpointLineId: string
}

const serializeMessageText = (message: UIMessage): string =>
  message.parts
    .map((part) => {
      if (part.type === 'text' || part.type === 'reasoning') {
        return part.text
      }
      return JSON.stringify(part)
    })
    .join('\n')
    .trim()

const buildActiveWindowMessages = (
  messages: UIMessage[],
  summary: string,
): UIMessage[] => {
  const reversed = [...messages].reverse()
  const kept: UIMessage[] = []
  let tokens = 0

  for (const message of reversed) {
    const text = serializeMessageText(message)
    const estimate = estimateTextTokens(text)
    if (tokens + estimate > compactBudgets.ACTIVE_WINDOW_TOKEN_BUDGET) {
      break
    }
    tokens += estimate
    kept.unshift(message)
  }

  if (kept.length === 0 && messages.length > 0) {
    const last = messages[messages.length - 1]
    if (last) {
      kept.push(last)
    }
  }

  const checkpointMessage: UIMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    parts: [
      {
        type: 'text',
        text: `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
      },
    ],
    metadata: { createdAt: new Date().toISOString() },
  }

  return [checkpointMessage, ...kept]
}

export default async (input: CompactSessionInput): Promise<CompactSessionResult> => {
  const {
    projectSlug,
    chatId,
    settings,
    messages,
    focus,
    signal,
    frozenSystem,
    chatModel,
  } = input

  try {
    const transcript = buildTranscript(messages)
    const compacted = await summarizeTranscript({
      settings,
      transcript,
      focus,
      signal,
      frozenSystem,
      chatModel,
    })

    if (input.onEvent) {
      await captureBillableUsage({
        projectSlug,
        chatId,
        turnId: input.turnId ?? `session:${chatId}`,
        source: 'compaction',
        providerId: compacted.modelRef.providerId,
        modelId: compacted.modelRef.modelId,
        usage: compacted.usage,
        providerMetadata: compacted.providerMetadata,
        responseId: compacted.responseId,
        settings,
        onEvent: input.onEvent,
      })
    }

    const summary = compacted.summary
    const checkpointLineId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    await appendChatLine(projectSlug, chatId, {
      id: checkpointLineId,
      role: 'assistant',
      parts: [],
      createdAt: nowIso,
      harnessEvent: {
        type: 'compaction',
        summary,
        focus: focus ?? null,
      },
    })

    const activeMessages = buildActiveWindowMessages(messages, summary)

    const firstRealMessage = activeMessages.find(
      (m) =>
        !(
          m.role === 'user' &&
          m.parts.some(
            (p) =>
              p.type === 'text' &&
              p.text.startsWith(compactBudgets.CHECKPOINT_PREFIX),
          )
        ),
    )
    const includeFromCreatedAt =
      (firstRealMessage?.metadata &&
      typeof (firstRealMessage.metadata as Record<string, unknown>).createdAt ===
        'string'
        ? ((firstRealMessage.metadata as Record<string, unknown>)
            .createdAt as string)
        : null) ?? nowIso

    await updateChatMeta(projectSlug, chatId, {
      activeContext: {
        checkpointLineId,
        includeFromCreatedAt,
        summary,
      },
    })

    return { summary, includeFromCreatedAt, checkpointLineId }
  } catch (error) {
    throw new Error(formatUnknownError(error))
  }
}
