import { toast } from 'vue-sonner'
import type { ModelMessage } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  buildModelTranscript,
  estimatePromptTokens,
  rewriteModelMessages,
  resolveCompactHighWater,
  summarizeTranscript,
} from '@/services/harness/compact'

type PrepareCompactStepInput = {
  settings: VixlSettings
  modelRef: ModelRef
  system: string
  signal: AbortSignal
  chatModel?: string
  projectSlug: string
  chatId: string
  turnId: string
  subagentId: string
  emitNestedEvent: (event: HarnessEvent) => void
  onBillEvent: (event: HarnessEvent) => void
}

export default (input: PrepareCompactStepInput) =>
  async (options: {
    messages: ModelMessage[]
  }): Promise<{ messages?: ModelMessage[] } | undefined> => {
    const { settings, modelRef, system } = input
    const estimated = estimatePromptTokens(system, options.messages)
    const highWater = resolveCompactHighWater(settings, modelRef)

    if (estimated <= highWater) {
      return undefined
    }

    input.emitNestedEvent({ type: 'compaction-started' })
    try {
      const transcript = buildModelTranscript(options.messages)
      const compacted = await summarizeTranscript({
        settings,
        transcript,
        focus: 'subagent',
        signal: input.signal,
        chatModel: input.chatModel,
      })
      const rewritten = rewriteModelMessages(options.messages, compacted.summary)
      const compactedEstimate = estimatePromptTokens(system, rewritten)
      if (compactedEstimate > highWater) {
        throw new Error(
          'Subagent context still exceeds the model window after compaction',
        )
      }

      input.emitNestedEvent({
        type: 'compaction',
        summary: compacted.summary,
        focus: 'subagent',
      })

      try {
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
          subagentId: input.subagentId,
          settings,
          onEvent: input.onBillEvent,
        })
      } catch (error) {
        // The rewrite is already applied, so an unexpected billing failure must
        // not abort the turn. captureBillableUsage toasts its own known
        // persist/enrich failures, so anything reaching here is unexpected:
        // surface it once and keep going.
        toast.error('Failed to record compaction usage', {
          description:
            error instanceof Error ? error.message : 'Unknown error',
        })
      }

      return { messages: rewritten }
    } finally {
      input.emitNestedEvent({ type: 'compaction-ended' })
    }
  }
