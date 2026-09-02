import { isLoopFinished, smoothStream, streamText } from 'ai'
import { toast } from 'vue-sonner'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import { rejectPendingForChat } from '@/services/harness/permission/approval-gate'
import { rejectPendingQuestionsForChat } from '@/services/harness/permission/question-gate'
import { rejectPendingMcpAuthForChat } from '@/services/mcp/mcp-auth-gate'
import enrichToolError from '@/services/harness/enrich-tool-error'
import { killShellsForChat } from '@/services/harness/shell/registry'
import { abort as abortSubagentsForChat } from '@/services/harness/subagent/registry'
import {
  hasPendingBackgroundResume,
  setTurnResponseMessages,
} from '@/services/harness/subagent/registry'
import { getPlanExecutionSession } from '@/services/harness/plan-execution-session'
import toCachedInstructions from '@/services/models/to-cached-instructions'
import emitContextUsage from './emit-context-usage'
import extractPartialToolPath from './extract-partial-tool-path'
import {
  nowIso,
  resolveStreamError,
  resolveToolErrorMessage,
} from './helpers'
import { persistLine } from './persistence'
import prepareParentCompactStep from './prepare-compact-step'
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
    projectSlug,
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
  let lastStepHadTokens = false
  const toolInputBuffers = new Map<string, string>()
  const toolInputNames = new Map<string, string>()

  const captureStepUsage = async (
    usage: Parameters<typeof captureBillableUsage>[0]['usage'],
    extras?: { providerMetadata?: unknown; responseId?: string },
  ): Promise<void> => {
    await captureBillableUsage({
      projectSlug,
      chatId,
      turnId: assistantId,
      source: 'main',
      providerId: callModel.createRef.providerId,
      modelId: callModel.createRef.modelId,
      usage,
      providerMetadata: extras?.providerMetadata,
      responseId: extras?.responseId,
      settings,
      onEvent,
    })
  }

  const result = streamText({
    model,
    instructions: toCachedInstructions(system, callOptions.providerOptions),
    messages: finalModelMessages,
    tools,
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
      () => getPlanExecutionSession(projectSlug, chatId).createdPlanThisTurn,
    ],
    prepareStep: prepareParentCompactStep({
      settings,
      modelRef: callModel.optionRef,
      system,
      signal,
      projectSlug,
      chatId,
      turnId: assistantId,
      messages,
      onEvent,
    }),
    abortSignal: signal,
    onAbort: async () => {
      rejectPendingForChat(chatId)
      rejectPendingQuestionsForChat(chatId)
      rejectPendingMcpAuthForChat(chatId)
      await killShellsForChat(chatId)
      abortSubagentsForChat(chatId)
      if (steps.trailingText || steps.assistantReasoning) {
        await persistLine(projectSlug, chatId, {
          id: assistantId,
          role: 'assistant',
          parts: [
            ...(steps.assistantReasoning
              ? [{ type: 'reasoning', text: steps.assistantReasoning }]
              : []),
            ...(steps.trailingText ? [{ type: 'text', text: steps.trailingText }] : []),
          ],
          createdAt: nowIso(),
          aborted: true,
        })
      }
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
      const path = extractPartialToolPath(toolInputBuffers, part.id, part.delta)
      if (path) {
        onEvent({
          type: 'tool-input-delta',
          toolCallId: part.id,
          name: toolInputNames.get(part.id) ?? '',
          args: { path },
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

  if (!lastStepHadTokens && !signal.aborted && !streamError) {
    try {
      const totalUsage = await result.usage
      if (emitContextUsage(totalUsage, modelId, onEvent)) {
        await captureStepUsage(totalUsage)
      }
    } catch (error) {
      toast.error('Failed to read model usage', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  // Prefer text already streamed into steps. Only fall back to result.text when
  // nothing was collected, and never re-emit it as a live delta (that duplicates
  // step text in the timeline UI).
  if (!steps.trailingText && !signal.aborted && !streamError) {
    if (steps.collectedStepText.trim()) {
      steps.trailingText = steps.collectedStepText
    } else {
      try {
        const finalText = await result.text
        if (finalText) {
          steps.trailingText = finalText
          onEvent({ type: 'text-delta', delta: finalText })
        }
      } catch (error) {
        streamError = resolveStreamError(error)
      }
    }
  }

  if (captureTurnMessages && hasPendingBackgroundResume(chatId)) {
    const responseMessages = await result.responseMessages
    setTurnResponseMessages(chatId, responseMessages)
  }

  if (streamError && !signal.aborted) {
    throw streamError
  }

  if (!signal.aborted && (steps.trailingText || steps.assistantReasoning)) {
    await persistLine(projectSlug, chatId, {
      id: assistantId,
      role: 'assistant',
      parts: [
        ...(steps.assistantReasoning
          ? [{ type: 'reasoning', text: steps.assistantReasoning }]
          : []),
        ...(steps.trailingText ? [{ type: 'text', text: steps.trailingText }] : []),
      ],
      createdAt: nowIso(),
    })
  }
}
