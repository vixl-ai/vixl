import type { ModelRef } from '@/types/models/model-ref'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import { isReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { getCustomProvider } from '@/services/providers/registry'
import pickCapabilityDefaultLevel from '@/services/models/pick-capability-default-level'
import resolveBuiltinReasoningCapability from '@/services/models/resolve-builtin-model-capabilities'

export type ReasoningCapability = {
  supported: boolean
  levels: ReasoningLevel[]
  mandatory: boolean
  defaultLevel: ReasoningLevel
}

const unsupported = (): ReasoningCapability => ({
  supported: false,
  levels: [],
  mandatory: false,
  defaultLevel: 'medium',
})

const uniqueLevels = (levels: ReasoningLevel[]): ReasoningLevel[] => {
  const seen = new Set<ReasoningLevel>()
  const next: ReasoningLevel[] = []
  for (const level of levels) {
    if (seen.has(level)) {
      continue
    }
    seen.add(level)
    next.push(level)
  }
  return next
}

const levelsFromCustomList = (values: string[]): ReasoningLevel[] => {
  const parsed = values.filter(isReasoningLevel)
  if (parsed.length === 0) {
    return []
  }
  if (!parsed.includes('provider-default')) {
    return uniqueLevels(['provider-default', ...parsed])
  }
  return uniqueLevels(parsed)
}

const fromLiveMetadata = (ref: ModelRef): ReasoningCapability | null => {
  const live = ref.supportsReasoningEffort
  if (!live || live.length === 0) {
    return null
  }
  const mandatory = ref.reasoningMandatory === true
  let levels = uniqueLevels(['provider-default', ...live])
  if (mandatory) {
    levels = levels.filter((level) => level !== 'none')
  }
  const builtin = resolveBuiltinReasoningCapability(ref)
  const preferred = builtin.supported ? builtin.defaultLevel : undefined
  return {
    supported: true,
    levels,
    mandatory,
    defaultLevel: pickCapabilityDefaultLevel(levels, preferred),
  }
}

export const resolveReasoningCapability = (
  settings: VixlSettings,
  ref: ModelRef | null | undefined,
): ReasoningCapability => {
  if (!ref) {
    return unsupported()
  }

  const customProvider = getCustomProvider(settings, ref.providerId)
  if (customProvider) {
    const model = customProvider.models?.find((entry) => entry.id === ref.modelId)
    if (!model?.supportsReasoningEffort?.length) {
      // thinking alone means local thinking tokens, not portable effort levels
      return unsupported()
    }
    const levels = levelsFromCustomList(model.supportsReasoningEffort)
    if (levels.length === 0) {
      return unsupported()
    }
    const preferred = isReasoningLevel(model.reasoningEffort) ? model.reasoningEffort : undefined
    return {
      supported: true,
      levels,
      mandatory: false,
      defaultLevel: pickCapabilityDefaultLevel(levels, preferred),
    }
  }

  const live = fromLiveMetadata(ref)
  if (live) {
    return live
  }

  return resolveBuiltinReasoningCapability(ref)
}

export default resolveReasoningCapability
