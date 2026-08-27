import { isLoopFinished, smoothStream, streamText } from 'ai'
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
import {
  nowIso,
  resolveStreamError,
  resolveToolErrorMessage,
} from './helpers'
import { persistLine } from './persistence'
import type { PreparedHarnessStream } from './prepare-stream'
import prepareParentCompactStep from './prepare-compact-step'

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
      const inputTokens = usage?.inputTokens ?? 0
      const cacheReadTokens = usage?.inputTokenDetails?.cacheReadTokens ?? 0
      const cacheWriteTokens = usage?.inputTokenDetails?.cacheWriteTokens ?? 0
      const outputTokens = usage?.outputTokens ?? 0
      // Last-step billing stats for the footer only. Ring fill uses the local
      // budget estimate from context-budget, not these provider counts.
      const promptTokens = inputTokens > 0
        ? inputTokens
        : cacheReadTokens + cacheWriteTokens
      onEvent({
        type: 'context-usage',
        modelId,
        promptTokens,
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
      })
      await captureBillableUsage({
        projectSlug,
        chatId,
        turnId: assistantId,
        source: 'main',
        providerId: callModel.createRef.providerId,
        modelId: callModel.createRef.modelId,
        usage,
        providerMetadata: part.providerMetadata,
        responseId: part.response?.id,
        settings,
        onEvent,
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
      onEvent({
        type: 'tool-input-start',
        toolCallId: part.id,
        name: part.toolName,
      })
      continue
    }

    if (part.type === 'tool-call') {
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
