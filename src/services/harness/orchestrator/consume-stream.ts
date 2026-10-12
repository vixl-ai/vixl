import { isLoopFinished, smoothStream, streamText } from 'ai'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import { rejectPendingForChat } from '@/services/harness/permission/approval-gate'
import { rejectPendingQuestionsForChat } from '@/services/harness/permission/question-gate'
import { rejectPendingMcpAuthForChat } from '@/services/mcp/mcp-auth-gate'
import enrichToolError from '@/services/harness/enrich-tool-error'
import { clearStagedImages } from '@/services/harness/image-stage'
import { killShellsForChat } from '@/services/harness/shell/registry'
import { abortBlocking } from '@/services/harness/subagent/registry'
import { getPlanExecutionSession } from '@/services/harness/plan-execution-session'
import toCachedInstructions from '@/services/models/to-cached-instructions'
import type { AgentStop } from '@/types/chat/agent-stop'
import emitContextUsage from './emit-context-usage'
import extractPartialToolFields from './extract-partial-tool-fields'
import { resolveStreamError, resolveToolErrorMessage } from './helpers'
import persistAssistantLine from './persist-assistant-line'
import prepareParentCompactStep from './prepare-compact-step'
import { publishTurnEnded, settleConsumedStream } from './settle-consumed-stream'
import prepareImageStep from './prepare-image-step'
import repairToolCall from './repair-tool-call'
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
    captureTurnMessages,
    messages,
  } = prepared

  let streamError: Error | null = null
  let hitOutputLimit = false
  let lastFinishReason: string | undefined
  let lastStepHadTokens = false
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

  const emitTurnEnded = (stop: AgentStop): Promise<void> =>
    publishTurnEnded({
      projectSlug: workspace.projectSlug,
      chatId,
      turnId: assistantId,
      stop,
      onEvent,
    })

  const result = streamText({
    model,
    instructions: toCachedInstructions(system, callOptions.providerOptions),
    messages: finalModelMessages,
    tools,
    repairToolCall,
    maxOutputTokens: callOptions.maxOutputTokens,
    temperature: callOptions.temperature,
    topP: callOptions.topP,
    topK: callOptions.topK,
    frequencyPenalty: callOptions.frequencyPenalty,
    presencePenalty: callOptions.presencePenalty,
    seed: callOptions.seed,
    reasoning: callOptions.reasoning,
    providerOptions: callOptions.providerOptions,
    experimental_transform: smoothStream({ chunking: 'word' }),
    stopWhen: [
      isLoopFinished(),
      () => getPlanExecutionSession(workspace.projectSlug, chatId).createdPlanThisTurn,
    ],
    prepareStep: prepareImageStep({
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
    }),
    abortSignal: signal,
    onAbort: async () => {
      rejectPendingForChat(chatId, { keepBackground: true })
      rejectPendingQuestionsForChat(chatId)
      rejectPendingMcpAuthForChat(chatId, { keepBackground: true })
      clearStagedImages({ chatId, turnId: assistantId })
      await killShellsForChat(chatId, { keepBackground: true })
      abortBlocking(chatId)
      steps.sealReasoningDuration()
      await persistCollectedAssistant(true)
      await emitTurnEnded({ reason: 'user-stop' })
      onEvent({
        type: 'turn-aborted',
        reason: 'user-stop',
        partialSteps: steps.stepCount,
      })
    },
  })

  for await (const part of result.fullStream) {
    if (signal.aborted) {
      break
    }

    if (part.type === 'start-step') {
      await steps.beginStep()
      continue
    }

    if (part.type === 'finish-step') {
      lastFinishReason = part.finishReason
      hitOutputLimit ||= part.finishReason === 'length'
      const usage = part.usage
      lastStepHadTokens = emitContextUsage(usage, modelId, onEvent)
      await captureStepUsage(usage, {
        providerMetadata: part.providerMetadata,
        responseId: part.response?.id,
      })
      await steps.finishStep()
      continue
    }

    if (part.type === 'reasoning-delta') {
      await steps.ensureStepOpen()
      steps.noteReasoningDelta()
      steps.assistantReasoning += part.text
      onEvent({
        type: 'reasoning-delta',
        delta: part.text,
        messageId: assistantId,
        stepId: steps.currentStepId,
      })
      continue
    }

    if (part.type === 'text-delta') {
      if (steps.stepOpen) {
        steps.sealReasoningDuration()
        steps.currentStepText += part.text
        onEvent({
          type: 'text-delta',
          delta: part.text,
          messageId: assistantId,
          stepId: steps.currentStepId,
        })
      } else {
        steps.trailingText += part.text
        onEvent({
          type: 'text-delta',
          delta: part.text,
          messageId: assistantId,
        })
      }
      continue
    }

    if (part.type === 'tool-input-start') {
      await steps.ensureStepOpen()
      toolInputNames.set(part.id, part.toolName)
      toolInputBuffers.set(part.id, '')
      onEvent({
        type: 'tool-input-start',
        toolCallId: part.id,
        name: part.toolName,
      })
      continue
    }

    if (part.type === 'tool-input-delta') {
      const fields = extractPartialToolFields(toolInputBuffers, part.id, part.delta)
      if (fields) {
        onEvent({
          type: 'tool-input-delta',
          toolCallId: part.id,
          name: toolInputNames.get(part.id) ?? '',
          args: fields,
        })
      }
      continue
    }

    if (part.type === 'tool-call') {
      toolInputBuffers.delete(part.toolCallId)
      toolInputNames.delete(part.toolCallId)
      await steps.ensureStepOpen()
      await steps.emitToolStart(part.toolCallId, part.toolName, part.input)
      continue
    }

    if (part.type === 'tool-result') {
      await steps.emitToolResult(
        part.toolCallId,
        part.toolName,
        part.output,
        false,
        part.input,
      )
      continue
    }

    if (part.type === 'tool-error') {
      const message = enrichToolError(resolveToolErrorMessage(part.error))
      await steps.ensureStepOpen()
      await steps.emitToolStart(part.toolCallId, part.toolName, part.input)
      await steps.emitToolResult(
        part.toolCallId,
        part.toolName,
        { error: message },
        true,
        part.input,
      )
      continue
    }

    if (part.type === 'error') {
      streamError = resolveStreamError(part.error)
    }
  }

  if (steps.stepOpen && !signal.aborted) {
    await steps.finishStep()
  }

  try {
    await settleConsumedStream({
      signal,
      streamError,
      result,
      steps,
      lastStepHadTokens,
      modelId,
      captureUsage: (usage) => captureStepUsage(usage),
      onEvent,
      captureTurnMessages,
      chatId,
      persistAssistant: () => persistCollectedAssistant(),
      hitOutputLimit,
      maxOutputTokens: callOptions.maxOutputTokens,
      cutOffToolNames: toolInputNames.values(),
      lastFinishReason,
      projectSlug: workspace.projectSlug,
      emitTurnEnded,
    })
  } finally {
    clearStagedImages({ chatId, turnId: assistantId })
  }
}
