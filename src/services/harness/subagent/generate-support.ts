import type { ModelMessage } from 'ai'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import deriveToolArtifact from '@/services/harness/derive-tool-artifact'
import enrichToolError from '@/services/harness/enrich-tool-error'
import {
  deriveToolDiffs,
  resolveToolErrorMessage,
} from '@/services/harness/orchestrator/helpers'
import { getSubagent, setMessages } from '@/services/harness/subagent/registry'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessToolContext } from '@/types/harness/tool-context'

type ToolExecutionStartEvent = {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}

type ToolExecutionEndEvent = {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
  toolOutput:
    | { type: 'tool-error'; error: unknown }
    | { type: 'tool-result'; output: unknown }
}

export const createSubagentToolExecutionHooks = (args: {
  emitNestedEvent: (event: HarnessEvent) => void
}): {
  onToolExecutionStart: (event: ToolExecutionStartEvent) => void
  onToolExecutionEnd: (event: ToolExecutionEndEvent) => void
} => ({
  onToolExecutionStart: (event) => {
    args.emitNestedEvent({
      type: 'tool-start',
      toolCallId: event.toolCall.toolCallId,
      name: event.toolCall.toolName,
      args: event.toolCall.input,
    })
  },
  onToolExecutionEnd: (event) => {
    const { toolCall, toolOutput } = event
    const isError = toolOutput.type === 'tool-error'
    const toolResult = isError
      ? {
          error: enrichToolError(resolveToolErrorMessage(toolOutput.error)),
        }
      : toolOutput.output
    const artifact = deriveToolArtifact(
      toolCall.toolName,
      toolResult,
      toolCall.input,
      isError,
    )
    const diffs = isError ? undefined : deriveToolDiffs(toolResult)
    args.emitNestedEvent({
      type: 'tool-result',
      toolCallId: toolCall.toolCallId,
      result: toolResult,
      isError,
      ...(artifact ? { artifact } : {}),
      ...(diffs ? { diffs } : {}),
    })
  },
})

export const readResponseMessages = (result: {
  responseMessages?: ModelMessage[]
  response?: { messages?: ModelMessage[] }
}): ModelMessage[] => {
  if (Array.isArray(result.responseMessages)) {
    return result.responseMessages
  }
  if (Array.isArray(result.response?.messages)) {
    return result.response.messages
  }
  return []
}

type GenerateHistoryResult = {
  responseMessages?: ModelMessage[]
  response?: { messages?: ModelMessage[] }
  steps?: Array<{ response?: { messages?: ModelMessage[] } }>
}

export const readLastStepResponseMessages = (
  result: GenerateHistoryResult,
): ModelMessage[] => {
  const lastStep = result.steps?.at(-1)?.response?.messages
  if (Array.isArray(lastStep)) {
    return lastStep
  }
  if (Array.isArray(result.response?.messages)) {
    return result.response.messages
  }
  if (Array.isArray(result.responseMessages)) {
    return result.responseMessages
  }
  return []
}

export const persistSubagentHistory = (
  emitNestedEvent: (event: HarnessEvent) => void,
  subagentId: string,
  messages: ModelMessage[],
): void => {
  setMessages(subagentId, messages)
  emitNestedEvent({ type: 'subagent-history', messages })
}

export const historyAfterGenerate = (
  subagentId: string,
  fallback: ModelMessage[],
  result: GenerateHistoryResult,
): ModelMessage[] => [
  // prepareStep snapshots input plus prior steps. ai v7 step.response.messages
  // and result.response.messages are the last step only; responseMessages is
  // cumulative across every step.
  ...(getSubagent(subagentId)?.messages ?? fallback),
  ...readLastStepResponseMessages(result),
]

export const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) {
    throw new Error('Subagent aborted')
  }
}

export const billSubagentUsage = async (args: {
  ctx: HarnessToolContext
  subagentId: string
  providerId: string
  modelId: string
  fast?: boolean
  generated: {
    usage?: Parameters<typeof captureBillableUsage>[0]['usage']
    providerMetadata?: unknown
    response?: { id?: string }
  }
}): Promise<void> => {
  await captureBillableUsage({
    projectSlug: args.ctx.projectSlug,
    chatId: args.ctx.chatId,
    turnId: args.ctx.turnId ?? `session:${args.ctx.chatId}`,
    source: 'subagent',
    providerId: args.providerId,
    modelId: args.modelId,
    usage: args.generated.usage,
    providerMetadata: args.generated.providerMetadata,
    responseId: args.generated.response?.id,
    subagentId: args.subagentId,
    settings: args.ctx.settings,
    fast: args.fast,
    // Emit on the parent harness channel (not nested) so chat-meta / turn-usage
    // reach the session without a subagent-event wrapper.
    onEvent: (event) => {
      args.ctx.onHarnessEvent?.(event)
    },
  })
}
