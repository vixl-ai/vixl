import type { ReasoningLevel } from '@/types/models/reasoning-level'

/**
 * Pick the concrete effort a model uses when the user has not chosen one.
 * `preferred` is a live-reported or family-table default, clamped to `levels`.
 */
export const pickCapabilityDefaultLevel = (
  levels: ReasoningLevel[],
  preferred?: ReasoningLevel,
): ReasoningLevel => {
  if (preferred !== undefined && preferred !== 'provider-default' && levels.includes(preferred)) {
    return preferred
  }
  if (levels.includes('medium')) {
    return 'medium'
  }
  const firstReal = levels.find((level) => level !== 'none' && level !== 'provider-default')
  if (firstReal) {
    return firstReal
  }
  const firstConcrete = levels.find((level) => level !== 'provider-default')
  if (firstConcrete) {
    return firstConcrete
  }
  return levels[0] ?? 'medium'
}

export default pickCapabilityDefaultLevel
