import captureBillableUsage from '@/services/billing/capture-billable-usage'
import { clearStagedImages } from '@/services/harness/image-stage'
import type { AgentStop } from '@/types/chat/agent-stop'
import {
  countImageFileParts,
  downgradeImageFileParts,
  isProviderImageRejection,
  providerImageRejectionNote,
} from './downgrade-rejected-images'
import persistAssistantLine from './persist-assistant-line'
import prepareParentCompactStep from './prepare-compact-step'
import { publishTurnEnded, settleConsumedStream } from './settle-consumed-stream'
import prepareImageStep from './prepare-image-step'
import pumpPreparedStream from './pump-prepared-stream'
import type { PreparedHarnessStream } from './prepare-stream'

export default async (prepared: PreparedHarnessStream): Promise<void> => {
  const {
    model,
    system,
    finalModelMessages,
    tools,
    callModel,
    callOptions,
    steps,
    workspace,
    chatId,
    modelId,
    settings,
    assistantId,
    signal,
    onEvent,
    flushSubagentPersistence,
    captureTurnMessages,
    messages,
  } = prepared

  const toolInputBuffers = new Map<string, string>()
  const toolInputNames = new Map<string, string>()

  const captureStepUsage = async (
    usage: Parameters<typeof captureBillableUsage>[0]['usage'],
    extras?: { providerMetadata?: unknown; responseId?: string },
  ): Promise<void> => {
    await captureBillableUsage({
      projectSlug: workspace.projectSlug,
      chatId,
      turnId: assistantId,
      source: 'main',
      providerId: callModel.optionRef.providerId,
      modelId: callModel.optionRef.modelId,
      usage,
      providerMetadata: extras?.providerMetadata,
      responseId: extras?.responseId,
      settings,
      fast: callModel.fast,
      onEvent,
    })
  }

  const persistCollectedAssistant = async (aborted?: boolean): Promise<void> => {
    await persistAssistantLine({
      projectSlug: workspace.projectSlug,
      chatId,
      assistantId,
      reasoningText: steps.assistantReasoning,
      reasoningSeconds: steps.sealedReasoningSeconds,
      trailingText: steps.trailingText,
      ...(aborted ? { aborted: true } : {}),
    })
  }

  const emitTurnEnded = async (stop: AgentStop): Promise<void> => {
    await flushSubagentPersistence()
    await publishTurnEnded({
      projectSlug: workspace.projectSlug,
      chatId,
      turnId: assistantId,
      stop,
      onEvent,
    })
  }

  const imagePrepare = prepareImageStep({
    chatId,
    turnId: assistantId,
    inner: prepareParentCompactStep({
      settings,
      model,
      modelRef: callModel.optionRef,
      system,
      providerOptions: callOptions.providerOptions,
      tools,
      signal,
      workspace,
      chatId,
      turnId: assistantId,
      messages,
      onEvent,
      fast: callModel.fast,
    }),
  })

  const pumpArgs = {
    prepared,
    imagePrepare,
    captureStepUsage,
    persistCollectedAssistant,
    emitTurnEnded,
    toolInputBuffers,
    toolInputNames,
  }

  let pumped = await pumpPreparedStream({
    ...pumpArgs,
    messagesForCall: finalModelMessages,
    hitOutputLimit: false,
    lastFinishReason: undefined,
    lastStepHadTokens: false,
  })
  const rejectedImageCount = pumped.streamError
    ? countImageFileParts(pumped.lastPreparedMessages)
    : 0
  let imageRejectionNote: string | null = null
  if (
    pumped.streamError &&
    !signal.aborted &&
    isProviderImageRejection(pumped.streamError.message) &&
    rejectedImageCount > 0
  ) {
    imageRejectionNote = providerImageRejectionNote(rejectedImageCount)
    onEvent({
      type: 'text-delta',
      delta: `\n${imageRejectionNote}\n`,
      messageId: assistantId,
    })
    pumped = await pumpPreparedStream({
      ...pumpArgs,
      messagesForCall: downgradeImageFileParts(pumped.lastPreparedMessages),
      hitOutputLimit: false,
      lastFinishReason: undefined,
      lastStepHadTokens: pumped.lastStepHadTokens,
    })
  }

  const foldImageRejectionNote = (): void => {
    if (!imageRejectionNote) {
      return
    }
    steps.trailingText = steps.trailingText
      ? `${steps.trailingText}\n${imageRejectionNote}`
      : imageRejectionNote
  }

  try {
    await settleConsumedStream({
      signal,
      streamError: pumped.streamError,
      result: pumped.result,
      steps,
      lastStepHadTokens: pumped.lastStepHadTokens,
      modelId,
      captureUsage: (usage) => captureStepUsage(usage),
      onEvent,
      captureTurnMessages,
      chatId,
      persistAssistant: async () => {
        foldImageRejectionNote()
        await persistCollectedAssistant()
      },
      hitOutputLimit: pumped.hitOutputLimit,
      maxOutputTokens: callOptions.maxOutputTokens,
      cutOffToolNames: toolInputNames.values(),
      lastFinishReason: pumped.lastFinishReason,
      projectSlug: workspace.projectSlug,
      emitTurnEnded,
    })
  } catch (error) {
    if (imageRejectionNote && pumped.streamError && !signal.aborted) {
      foldImageRejectionNote()
      await persistCollectedAssistant()
    }
    throw error
  } finally {
    clearStagedImages({ chatId, turnId: assistantId })
  }
}
