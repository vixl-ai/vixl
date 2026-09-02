import type { LanguageModelUsage } from 'ai'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import readLanguageModelUsageTokens from '@/services/billing/read-language-model-usage-tokens'

type NormalizedUsage = BillableUsageRecord['usage'] & { usageMissing: boolean }

const isAbsentOrZero = (value: number | undefined): boolean =>
  value === undefined || value === 0

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Flatten AI SDK LanguageModelUsage into the billable usage snapshot.
 * Copies fields verbatim when present. Fills input/output from raw when
 * flattened counts are missing. Never invents tokens.
 */
export default (usage: LanguageModelUsage | undefined): NormalizedUsage => {
  if (!usage) {
    return { usageMissing: true }
  }

  const tokens = readLanguageModelUsageTokens(usage)
  const inputTokens = tokens.inputTokens ?? finiteNumber(usage.inputTokens)
  const noCacheTokens = finiteNumber(usage.inputTokenDetails?.noCacheTokens)
  const cacheReadTokens =
    tokens.cacheReadTokens ??
    finiteNumber(usage.inputTokenDetails?.cacheReadTokens)
  const cacheWriteTokens =
    tokens.cacheWriteTokens ??
    finiteNumber(usage.inputTokenDetails?.cacheWriteTokens)
  const outputTokens = tokens.outputTokens ?? finiteNumber(usage.outputTokens)
  const textTokens = finiteNumber(usage.outputTokenDetails?.textTokens)
  const reasoningTokens = finiteNumber(usage.outputTokenDetails?.reasoningTokens)
  const totalTokens = finiteNumber(usage.totalTokens)
  const raw = usage.raw

  const usageMissing =
    isAbsentOrZero(inputTokens) &&
    isAbsentOrZero(noCacheTokens) &&
    isAbsentOrZero(cacheReadTokens) &&
    isAbsentOrZero(cacheWriteTokens) &&
    isAbsentOrZero(outputTokens) &&
    isAbsentOrZero(textTokens) &&
    isAbsentOrZero(reasoningTokens) &&
    isAbsentOrZero(totalTokens)

  const normalized: NormalizedUsage = { usageMissing }

  if (inputTokens !== undefined) {
    normalized.inputTokens = inputTokens
  }
  if (noCacheTokens !== undefined) {
    normalized.noCacheTokens = noCacheTokens
  }
  if (cacheReadTokens !== undefined) {
    normalized.cacheReadTokens = cacheReadTokens
  }
  if (cacheWriteTokens !== undefined) {
    normalized.cacheWriteTokens = cacheWriteTokens
  }
  if (outputTokens !== undefined) {
    normalized.outputTokens = outputTokens
  }
  if (reasoningTokens !== undefined) {
    normalized.reasoningTokens = reasoningTokens
  }
  if (textTokens !== undefined) {
    normalized.textTokens = textTokens
  }
  if (totalTokens !== undefined) {
    normalized.totalTokens = totalTokens
  }
  if (raw !== undefined) {
    normalized.raw = raw
  }

  return normalized
}
