import type { ModelMessage } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { PyrolaSettings } from '@/types/pyrola/pyrola-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import {
  compactBudgets,
  rewriteModelMessages,
  summarizeTranscript,
} from '@/services/harness/compact'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  resolveContextWindow,
  resolveMaxInputTokens,
  resolveModelCallOptions,
} from '@/services/models/resolve-model-call-options'
import estimateTextTokens from '@/utils/estimate-text-tokens'

type PrepareCompactStepInput = {
  settings: PyrolaSettings
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

const FALLBACK_CONTEXT_WINDOW = 128_000

const estimatePromptTokens = (
  system: string,
  messages: ModelMessage[],
): number =>
  estimateTextTokens(system) +
  messages.reduce(
    (sum, message) => sum + estimateTextTokens(JSON.stringify(message)),
    0,
  )

const resolveChildWindow = (
  settings: PyrolaSettings,
  modelRef: ModelRef,
): number => {
  const maxInput = resolveMaxInputTokens(settings, modelRef)
  if (typeof maxInput === 'number' && maxInput > 0) {
    return maxInput
  }
  const contextWindow = resolveContextWindow(settings, modelRef)
  if (typeof contextWindow === 'number' && contextWindow > 0) {
    return contextWindow
  }
  return FALLBACK_CONTEXT_WINDOW
}

const serializeModelMessageText = (message: ModelMessage): string => {
  if ('content' in message && typeof message.content === 'string') {
    return message.content
  }
  if ('content' in message) {
    return JSON.stringify(message.content)
  }
  return JSON.stringify(message)
}

const buildModelMessageTranscript = (messages: ModelMessage[]): string => {
  const reversed = [...messages].reverse()
  const kept: string[] = []
  let tokens = 0

  for (const message of reversed) {
    const text = serializeModelMessageText(message)
    if (!text) {
      continue
    }
    const line = `${message.role.toUpperCase()}:\n${text}`
    const estimate = estimateTextTokens(line)
    const remaining = compactBudgets.TRANSCRIPT_TOKEN_BUDGET - tokens
    if (estimate > remaining) {
      if (kept.length > 0) {
        break
      }
      const truncated = line.slice(0, Math.max(0, remaining * 4))
      if (truncated) {
        kept.unshift(truncated)
      }
      break
    }
    tokens += estimate
    kept.unshift(line)
  }

  if (kept.length === 0) {
    return '(empty conversation)'
  }

  return kept.join('\n\n')
}

export default (input: PrepareCompactStepInput) =>
  async (options: {
    messages: ModelMessage[]
  }): Promise<{ messages?: ModelMessage[] } | undefined> => {
    const { settings, modelRef, system } = input
    const estimated = estimatePromptTokens(system, options.messages)
    const windowTokens = resolveChildWindow(settings, modelRef)
    const reserved =
      resolveModelCallOptions(settings, modelRef, {
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      }).maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    const highWater = Math.floor((windowTokens - reserved) * 0.7)

    if (estimated <= highWater) {
      return undefined
    }

    const transcript = buildModelMessageTranscript(options.messages)
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

    return { messages: rewritten }
  }
