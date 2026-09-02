import extractCacheWriteFromRaw from '@/services/billing/extract-cache-write-from-raw'

type UsageTokens = {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const positiveFinite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined

const sumPositive = (...values: unknown[]): number | undefined => {
  let sum = 0
  let found = false
  for (const value of values) {
    const token = positiveFinite(value)
    if (token === undefined) {
      continue
    }
    sum += token
    found = true
  }
  return found ? sum : undefined
}

const nestedTotal = (value: unknown): number | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  return positiveFinite(value.total)
}

const readRawInput = (raw: Record<string, unknown>): number | undefined =>
  positiveFinite(raw.prompt_tokens) ??
  positiveFinite(raw.input_tokens) ??
  positiveFinite(raw.promptTokenCount)

const readRawOutput = (raw: Record<string, unknown>): number | undefined =>
  positiveFinite(raw.completion_tokens) ??
  positiveFinite(raw.output_tokens) ??
  positiveFinite(raw.candidatesTokenCount)

const readRawCacheRead = (raw: Record<string, unknown>): number | undefined => {
  const promptDetails = isRecord(raw.prompt_tokens_details)
    ? raw.prompt_tokens_details
    : undefined
  const inputDetails = isRecord(raw.input_tokens_details)
    ? raw.input_tokens_details
    : undefined
  return (
    positiveFinite(promptDetails?.cached_tokens) ??
    positiveFinite(inputDetails?.cached_tokens) ??
    positiveFinite(raw.cache_read_input_tokens) ??
    positiveFinite(raw.cachedContentTokenCount) ??
    positiveFinite(raw.cached_tokens)
  )
}

/**
 * Read billable token counts from flattened usage, details, or provider raw.
 * Never invents tokens: absent stays undefined, not 0.
 */
export default (usage: unknown): UsageTokens => {
  if (!isRecord(usage)) {
    return {}
  }

  const details = isRecord(usage.inputTokenDetails)
    ? usage.inputTokenDetails
    : undefined
  const outputDetails = isRecord(usage.outputTokenDetails)
    ? usage.outputTokenDetails
    : undefined
  const nestedInput = isRecord(usage.inputTokens) ? usage.inputTokens : undefined
  const nestedOutput = isRecord(usage.outputTokens)
    ? usage.outputTokens
    : undefined
  const raw = isRecord(usage.raw) ? usage.raw : undefined

  const inputTokens =
    positiveFinite(usage.inputTokens) ??
    nestedTotal(usage.inputTokens) ??
    sumPositive(
      details?.noCacheTokens,
      details?.cacheReadTokens,
      details?.cacheWriteTokens,
    ) ??
    sumPositive(
      nestedInput?.noCache,
      nestedInput?.cacheRead,
      nestedInput?.cacheWrite,
    ) ??
    (raw ? readRawInput(raw) : undefined)

  const outputTokens =
    positiveFinite(usage.outputTokens) ??
    nestedTotal(usage.outputTokens) ??
    sumPositive(outputDetails?.textTokens, outputDetails?.reasoningTokens) ??
    sumPositive(nestedOutput?.text, nestedOutput?.reasoning) ??
    (raw ? readRawOutput(raw) : undefined)

  const cacheReadTokens =
    positiveFinite(details?.cacheReadTokens) ??
    positiveFinite(nestedInput?.cacheRead) ??
    (raw ? readRawCacheRead(raw) : undefined)

  const cacheWriteFromRaw = extractCacheWriteFromRaw(undefined, raw)
  const cacheWriteTokens =
    positiveFinite(details?.cacheWriteTokens) ??
    positiveFinite(nestedInput?.cacheWrite) ??
    positiveFinite(cacheWriteFromRaw)

  const tokens: UsageTokens = {}
  if (inputTokens !== undefined) {
    tokens.inputTokens = inputTokens
  }
  if (outputTokens !== undefined) {
    tokens.outputTokens = outputTokens
  }
  if (cacheReadTokens !== undefined) {
    tokens.cacheReadTokens = cacheReadTokens
  }
  if (cacheWriteTokens !== undefined) {
    tokens.cacheWriteTokens = cacheWriteTokens
  }
  return tokens
}
