import { toast } from 'vue-sonner'
import type { ModelMessage, UIMessage } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { GenerateCheckpointInput } from '@/types/harness/generate-checkpoint'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'
import type { ModelRef } from '@/types/models/model-ref'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  estimatePromptTokens,
  persistCompactionCheckpoint,
  resolveCompactHighWater,
  resolveCompactWindow,
  runCompactRewrite,
} from '@/services/harness/compact'

type PrepareParentCompactStepInput = {
  settings: VixlSettings
  modelRef: ModelRef
  system: string
  signal: AbortSignal
  workspace: HarnessWorkspace
  chatId: string
  turnId: string
  messages: UIMessage[]
  onEvent: (event: HarnessEvent) => void
} & Pick<GenerateCheckpointInput, 'model' | 'tools' | 'providerOptions'>

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

    input.onEvent({ type: 'compaction-started' })
    try {
      const compactedRewrite = await runCompactRewrite({
        checkpointInput: {
          model: input.model,
          modelRef,
          system,
          providerOptions: input.providerOptions,
          tools: input.tools,
          messages: options.messages,
          focus: 'parent',
          signal: input.signal,
        },
        system,
        messages: options.messages,
        highWater,
        hardWindow: resolveCompactWindow(settings, modelRef),
      })

      const checkpoint = await persistCompactionCheckpoint({
        projectSlug: input.workspace.projectSlug,
        chatId: input.chatId,
        summary: compactedRewrite.summary,
        focus: 'parent',
        messages: input.messages,
      })

      input.onEvent({
        type: 'compaction',
        summary: compactedRewrite.summary,
        focus: 'parent',
      })
      input.onEvent({
        type: 'chat-meta-changed',
        projectSlug: input.workspace.projectSlug,
        chatId: input.chatId,
        patch: {
          activeContext: {
            checkpointLineId: checkpoint.checkpointLineId,
            includeFromCreatedAt: checkpoint.includeFromCreatedAt,
            summary: checkpoint.summary,
          },
        },
      })

      const compacted = compactedRewrite.compacted
      if (compacted) {
        try {
          await captureBillableUsage({
            projectSlug: input.workspace.projectSlug,
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
        } catch (error) {
          toast.error('Failed to record compaction usage', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          })
        }
      }

      return { messages: compactedRewrite.messages }
    } finally {
      input.onEvent({ type: 'compaction-ended' })
    }
  }
