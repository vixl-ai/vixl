import type { UIMessage } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  buildTimelineTranscript,
  persistCompactionCheckpoint,
  summarizeTranscript,
} from '@/services/harness/compact'
import formatUnknownError from '@/utils/format-unknown-error'

export type CompactSessionInput = {
  projectSlug: string
  chatId: string
  projectRoot: string
  settings: VixlSettings
  messages: UIMessage[]
  timeline: ChatTimelineItem[]
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

export default async (input: CompactSessionInput): Promise<CompactSessionResult> => {
  const {
    projectSlug,
    chatId,
    settings,
    messages,
    timeline,
    focus,
    signal,
    frozenSystem,
    chatModel,
  } = input

  try {
    const transcript = buildTimelineTranscript(timeline)
    if (!transcript.trim()) {
      throw new Error('Nothing to compact')
    }
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

    return persistCompactionCheckpoint({
      projectSlug,
      chatId,
      summary: compacted.summary,
      focus,
      messages,
    })
  } catch (error) {
    throw new Error(formatUnknownError(error))
  }
}
