import type { LanguageModelUsage, ModelMessage } from 'ai'
import { toast } from 'vue-sonner'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { getPlanExecutionSession } from '@/services/harness/plan-execution-session'
import {
  getTurnResponseMessages,
  hasPendingBackgroundResume,
  setTurnResponseMessages,
} from '@/services/harness/subagent/registry'
import describeOutputLimitTruncation from './describe-output-limit-truncation'
import emitContextUsage from './emit-context-usage'
import { resolveStreamError } from './helpers'
import { persistTurnEnded } from './persistence'

type StepTail = {
  trailingText: string
  collectedStepText: string
}

type StreamTail = {
  usage: PromiseLike<LanguageModelUsage>
  text: PromiseLike<string>
  responseMessages: PromiseLike<ModelMessage[]>
}

type EmitTurnEnded = (stop: AgentStop) => Promise<void>

export const publishTurnEnded = async (args: {
  projectSlug: string
  chatId: string
  turnId: string
  stop: AgentStop
  onEvent: (event: HarnessEvent) => void | Promise<void>
}): Promise<void> => {
  args.onEvent({ type: 'turn-ended', turnId: args.turnId, stop: args.stop })
  try {
    await persistTurnEnded(args.projectSlug, args.chatId, args.turnId, args.stop)
  } catch (error) {
    toast.error('Failed to save turn end', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const successStop = (
  projectSlug: string,
  chatId: string,
  lastFinishReason: string | undefined,
): AgentStop => {
  if (lastFinishReason === 'content-filter') {
    return { reason: 'content-filter', finish: 'content-filter' }
  }
  const createdPlanThisTurn = getPlanExecutionSession(
    projectSlug,
    chatId,
  ).createdPlanThisTurn
  return {
    reason: 'completed',
    ...(typeof lastFinishReason === 'string' ? { finish: lastFinishReason } : {}),
    ...(createdPlanThisTurn ? { detail: 'plan' } : {}),
  }
}

export const settleConsumedStream = async (input: {
  signal: AbortSignal
  streamError: Error | null
  result: StreamTail
  steps: StepTail
  lastStepHadTokens: boolean
  modelId: string
  captureUsage: (usage: LanguageModelUsage) => Promise<void>
  onEvent: (event: HarnessEvent) => void | Promise<void>
  captureTurnMessages: boolean
  chatId: string
  persistAssistant: () => Promise<void>
  hitOutputLimit: boolean
  maxOutputTokens: number | undefined
  cutOffToolNames: Iterable<string>
  lastFinishReason: string | undefined
  projectSlug: string
  emitTurnEnded: EmitTurnEnded
}): Promise<void> => {
  let streamError = input.streamError
  if (!input.lastStepHadTokens && !input.signal.aborted && !streamError) {
    try {
      const totalUsage = await input.result.usage
      if (emitContextUsage(totalUsage, input.modelId, input.onEvent)) {
        await input.captureUsage(totalUsage)
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
  if (!input.steps.trailingText && !input.signal.aborted && !streamError) {
    if (input.steps.collectedStepText.trim()) {
      input.steps.trailingText = input.steps.collectedStepText
    } else {
      try {
        const finalText = await input.result.text
        if (finalText) {
          input.steps.trailingText = finalText
          input.onEvent({ type: 'text-delta', delta: finalText })
        }
      } catch (error) {
        streamError = resolveStreamError(error)
      }
    }
  }

  if (
    input.captureTurnMessages &&
    hasPendingBackgroundResume(input.chatId) &&
    !getTurnResponseMessages(input.chatId)
  ) {
    const responseMessages = await input.result.responseMessages
    setTurnResponseMessages(input.chatId, responseMessages)
  }

  if (streamError && !input.signal.aborted) {
    throw streamError
  }

  if (!input.signal.aborted) {
    await input.persistAssistant()
  }

  if (input.hitOutputLimit && !input.signal.aborted) {
    const detail = describeOutputLimitTruncation({
      maxOutputTokens: input.maxOutputTokens,
      cutOffToolNames: input.cutOffToolNames,
    })
    await input.emitTurnEnded({ reason: 'output-limit', detail, finish: 'length' })
    throw new Error(detail)
  }

  if (input.signal.aborted) {
    return
  }

  await input.emitTurnEnded(
    successStop(input.projectSlug, input.chatId, input.lastFinishReason),
  )
}
