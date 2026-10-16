import { isLoopFinished, smoothStream, streamText, type ModelMessage } from 'ai'
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
import prepareImageStep from './prepare-image-step'
import repairToolCall from './repair-tool-call'
import type { PreparedHarnessStream } from './prepare-stream'

export type PumpedPreparedStream = {
  result: ReturnType<typeof streamText>
  lastPreparedMessages: ModelMessage[]
  streamError: Error | null
  hitOutputLimit: boolean
  lastFinishReason: string | undefined
  lastStepHadTokens: boolean
}

type PumpPreparedStreamInput = {
  prepared: PreparedHarnessStream
  messagesForCall: ModelMessage[]
  imagePrepare: ReturnType<typeof prepareImageStep>
  captureStepUsage: (
    usage: Parameters<typeof captureBillableUsage>[0]['usage'],
    extras?: { providerMetadata?: unknown; responseId?: string },
  ) => Promise<void>
  persistCollectedAssistant: (aborted?: boolean) => Promise<void>
  emitTurnEnded: (stop: AgentStop) => Promise<void>
  toolInputBuffers: Map<string, string>
  toolInputNames: Map<string, string>
  hitOutputLimit: boolean
  lastFinishReason: string | undefined
  lastStepHadTokens: boolean
}

export default async (
  input: PumpPreparedStreamInput,
): Promise<PumpedPreparedStream> => {
  const {
    prepared,
    messagesForCall,
    imagePrepare,
    captureStepUsage,
    persistCollectedAssistant,
    emitTurnEnded,
    toolInputBuffers,
    toolInputNames,
  } = input
  const {
    model,
    system,
    tools,
    callOptions,
    steps,
    workspace,
    chatId,
    modelId,
    assistantId,
    signal,
    onEvent,
  } = prepared

  let lastPreparedMessages = messagesForCall
  let streamError: Error | null = null
  let hitOutputLimit = input.hitOutputLimit
  let lastFinishReason = input.lastFinishReason
  let lastStepHadTokens = input.lastStepHadTokens

  const result = streamText({
    model,
    instructions: toCachedInstructions(system, callOptions.providerOptions),
    messages: messagesForCall,
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
    prepareStep: async (options) => {
      const preparedStep = await imagePrepare(options)
      lastPreparedMessages = preparedStep?.messages ?? options.messages
      return preparedStep
    },
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

  return {
    result,
    lastPreparedMessages,
    streamError,
    hitOutputLimit,
    lastFinishReason,
    lastStepHadTokens,
  }
}
