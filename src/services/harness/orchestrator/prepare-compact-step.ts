import type { ModelMessage, UIMessage } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  buildModelTranscript,
  estimatePromptTokens,
  persistCompactionCheckpoint,
  rewriteModelMessages,
  resolveCompactHighWater,
  summarizeTranscript,
} from '@/services/harness/compact'
import { MODEL_REF_SEPARATOR, type ModelRef } from '@/types/models/model-ref'

type PrepareParentCompactStepInput = {
  settings: VixlSettings
  modelRef: ModelRef
  system: string
  signal: AbortSignal
  projectSlug: string
  chatId: string
  turnId: string
  messages: UIMessage[]
  onEvent: (event: HarnessEvent) => void
}

export default (input: PrepareParentCompactStepInput) =>
  async (options: {
    messages: ModelMessage[]
  }): Promise<{ messages?: ModelMessage[] } | undefined> => {
    if (input.signal.aborted) {
      return undefined
    }

    const { settings, modelRef, system } = input
    const estimated = estimatePromptTokens(system, options.messages)
    const highWater = resolveCompactHighWater(settings, modelRef)

    if (estimated <= highWater) {
      return undefined
    }

    const transcript = buildModelTranscript(options.messages)
    const compacted = await summarizeTranscript({
      settings,
      transcript,
      focus: 'parent',
      signal: input.signal,
      chatModel: `${modelRef.providerId}${MODEL_REF_SEPARATOR}${modelRef.modelId}`,
    })
    const rewritten = rewriteModelMessages(options.messages, compacted.summary)
    const compactedEstimate = estimatePromptTokens(system, rewritten)
    if (compactedEstimate > highWater) {
      throw new Error(
        'Parent context still exceeds the model window after compaction',
      )
    }

    const checkpoint = await persistCompactionCheckpoint({
      projectSlug: input.projectSlug,
      chatId: input.chatId,
      summary: compacted.summary,
      focus: 'parent',
      messages: input.messages,
    })

    input.onEvent({
      type: 'compaction',
      summary: compacted.summary,
      focus: 'parent',
    })
    input.onEvent({
      type: 'chat-meta-changed',
      projectSlug: input.projectSlug,
      chatId: input.chatId,
      patch: {
        activeContext: {
          checkpointLineId: checkpoint.checkpointLineId,
          includeFromCreatedAt: checkpoint.includeFromCreatedAt,
          summary: checkpoint.summary,
        },
      },
    })

    await captureBillableUsage({
      projectSlug: input.projectSlug,
      chatId: input.chatId,
      turnId: input.turnId,
      source: 'compaction',
      providerId: compacted.modelRef.providerId,
      modelId: compacted.modelRef.modelId,
      usage: compacted.usage,
      providerMetadata: compacted.providerMetadata,
      responseId: compacted.responseId,
      settings,
      onEvent: input.onEvent,
    })

    return { messages: rewritten }
  }
