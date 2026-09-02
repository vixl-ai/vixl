import readLanguageModelUsageTokens from '@/services/billing/read-language-model-usage-tokens'
import type { HarnessEvent } from '@/types/harness/harness-event'

/**
 * Emit last-step context-usage from helper-extracted tokens.
 * Returns true when the snapshot had at least one reported count.
 */
export default (
  usage: unknown,
  modelId: string,
  onEvent: (event: HarnessEvent) => void,
): boolean => {
  const tokens = readLanguageModelUsageTokens(usage)
  const inputTokens = tokens.inputTokens ?? 0
  const outputTokens = tokens.outputTokens ?? 0
  const cacheReadTokens = tokens.cacheReadTokens ?? 0
  const cacheWriteTokens = tokens.cacheWriteTokens ?? 0
  const hadTokens =
    tokens.inputTokens !== undefined ||
    tokens.outputTokens !== undefined ||
    tokens.cacheReadTokens !== undefined ||
    tokens.cacheWriteTokens !== undefined
  if (!hadTokens) {
    return false
  }
  const promptTokens =
    inputTokens > 0 ? inputTokens : cacheReadTokens + cacheWriteTokens
  onEvent({
    type: 'context-usage',
    modelId,
    promptTokens,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
  })
  return true
}
