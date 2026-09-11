import { toast } from 'vue-sonner'
import {
  convertToModelMessages,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from 'ai'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import filterMessagesForActiveContext, {
  type FilteredActiveContextMessages,
} from '@/services/context/filter-messages-for-active-context'
import {
  persistCompactionCheckpoint,
  resolveCompactHighWater,
  resolveCompactWindow,
  runCompactRewrite,
} from '@/services/harness/compact'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import { resolveSideTaskCallOptions } from '@/services/models/resolve-model-call-options'
import { resolveParsedModelForRole } from '@/services/models/resolve-model-for-role'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'

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
  usedFallback: boolean
}

const toNativePrefix = async (input: {
  filtered: FilteredActiveContextMessages
  settings: VixlSettings
  model: LanguageModel
  modelRef: ModelRef
}): Promise<ModelMessage[]> => {
  const { messages: contextMessages, checkpointText } = input.filtered
  const supportsVision = await resolveModelVision({
    model: input.model,
    providerId: input.modelRef.providerId,
    modelId: input.modelRef.modelId,
    settings: input.settings,
  })
  const recentModelMessages = await convertToModelMessages(
    await prepareMessagesForModelVision(contextMessages, supportsVision),
  )
  if (!checkpointText) {
    return recentModelMessages
  }
  return [
    {
      role: 'user',
      content: checkpointText,
    },
    ...recentModelMessages,
  ]
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
    const activeContextMeta = await readChatMeta(projectSlug, chatId).catch(
      () => null,
    )
    const filtered = filterMessagesForActiveContext(
      messages,
      activeContextMeta?.activeContext,
    )
    if (filtered.messages.length === 0 && !filtered.checkpointText) {
      throw new Error('Nothing to compact')
    }

    const modelRef = resolveParsedModelForRole(
      'default',
      settings,
      chatModel,
    )
    if (!modelRef) {
      throw new Error(
        'No model configured for compaction. Set a default model in Settings.',
      )
    }

    const model = await createModel({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      settings,
    })
    const nativeMessages = await toNativePrefix({
      filtered,
      settings,
      model,
      modelRef,
    })
    if (nativeMessages.length === 0) {
      throw new Error('Nothing to compact')
    }

    const callOptions = resolveSideTaskCallOptions(settings, modelRef)
    const result = await runCompactRewrite({
      checkpointInput: {
        model,
        modelRef,
        system: frozenSystem ?? '',
        providerOptions: callOptions.providerOptions,
        tools: {},
        messages: nativeMessages,
        focus: focus ?? 'none',
        signal: signal ?? new AbortController().signal,
      },
      system: frozenSystem ?? '',
      messages: nativeMessages,
      highWater: resolveCompactHighWater(settings, modelRef),
      hardWindow: resolveCompactWindow(settings, modelRef),
    })

    const compacted = result.compacted
    const checkpoint = await persistCompactionCheckpoint({
      projectSlug,
      chatId,
      summary: result.summary,
      focus,
      messages,
    })

    if (input.onEvent && compacted) {
      try {
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
      } catch (error) {
        toast.error('Failed to record compaction usage', {
          description:
            error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      ...checkpoint,
      usedFallback:
        compacted === null || result.summary !== compacted.summary,
    }
  } catch (error) {
    throw new Error(formatUnknownError(error))
  }
}
