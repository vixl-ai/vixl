import estimateTextTokens from '@/utils/estimate-text-tokens'

const SUBAGENT_TOOL_RESULT_TOKEN_CAP = 8000
const SUBAGENT_TOOL_RESULT_CHAR_CAP = SUBAGENT_TOOL_RESULT_TOKEN_CAP * 4

const tryStringify = (value: unknown): string | null => {
  try {
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : null
  } catch {
    return null
  }
}

const tokensOf = (value: unknown): number | null => {
  const json = tryStringify(value)
  if (json === null) {
    return null
  }
  return estimateTextTokens(json)
}

const fitsUnderCap = (value: unknown): boolean => {
  const tokens = tokensOf(value)
  return tokens !== null && tokens <= SUBAGENT_TOOL_RESULT_TOKEN_CAP
}

const largestPrefix = <T>(
  items: T[],
  build: (kept: T[]) => unknown,
): T[] => {
  let low = 0
  let high = items.length
  let best = 0
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    if (fitsUnderCap(build(items.slice(0, mid)))) {
      best = mid
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return items.slice(0, best)
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const capString = (value: string): unknown => ({
  content: value.slice(0, SUBAGENT_TOOL_RESULT_CHAR_CAP),
  truncated: true,
  originalChars: value.length,
})

const capGrepLike = (matches: unknown[]): unknown => ({
  matches: largestPrefix(matches, (kept) => ({
    matches: kept,
    truncated: true,
    matchCount: matches.length,
  })),
  truncated: true,
  matchCount: matches.length,
})

const capArray = (items: unknown[]): unknown => ({
  items: largestPrefix(items, (kept) => ({
    items: kept,
    truncated: true,
    originalCount: items.length,
  })),
  truncated: true,
  originalCount: items.length,
})

const capSerializedPreview = (serialized: string): unknown => ({
  truncated: true,
  preview: serialized.slice(0, SUBAGENT_TOOL_RESULT_CHAR_CAP),
  originalChars: serialized.length,
})

const capToolOutput = (result: unknown): unknown => {
  const serialized = tryStringify(result)
  if (serialized === null) {
    return { truncated: true, error: 'unserializable tool result' }
  }
  if (estimateTextTokens(serialized) <= SUBAGENT_TOOL_RESULT_TOKEN_CAP) {
    return result
  }
  if (typeof result === 'string') {
    return capString(result)
  }
  if (Array.isArray(result)) {
    return capArray(result)
  }
  if (isPlainObject(result) && Array.isArray(result.matches)) {
    return capGrepLike(result.matches)
  }
  if (isPlainObject(result)) {
    return capSerializedPreview(serialized)
  }
  return capSerializedPreview(serialized)
}

export default capToolOutput
