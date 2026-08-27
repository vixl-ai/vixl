const CONTEXT_TIERS = [128_000, 256_000, 1_000_000, 2_000_000] as const

const OUTPUT_TIERS = [4_096, 8_192, 16_384, 32_768, 65_536, 128_000] as const

const uniqueSorted = (values: number[]): number[] =>
  [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort(
    (left, right) => left - right,
  )

const collectTiers = (
  reportedMax: number | undefined,
  tiers: readonly number[],
  current?: number,
): number[] => {
  if (typeof reportedMax !== 'number' || reportedMax <= 0) {
    return []
  }
  const next = tiers.filter((tier) => tier < reportedMax * 0.9)
  next.push(reportedMax)
  if (typeof current === 'number' && current > 0 && current <= reportedMax) {
    next.push(current)
  }
  return uniqueSorted(next)
}

export const contextWindowSelectValues = (
  reportedMax: number | undefined,
  current?: number,
): number[] => {
  const values = collectTiers(reportedMax, CONTEXT_TIERS, current)
  return values.length >= 2 ? values : []
}

export const maxOutputSelectValues = (
  reportedMax: number | undefined,
  current?: number,
): number[] => {
  const values = collectTiers(reportedMax, OUTPUT_TIERS, current)
  return values.length >= 2 ? values : []
}
