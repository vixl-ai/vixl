import type { ModelRef } from '@/types/models/model-ref'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import { isReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ModelRoleId } from '@/data/model-role-registry'
import { MODEL_ROLE_REGISTRY } from '@/data/model-role-registry'
import {
  getCustomProvider,
  getProviderCatalogEntry,
} from '@/services/providers/registry'
import { getModelCatalogOption } from '@/services/models/model-catalog-options'
import clampModelCatalogOption from '@/services/models/clamp-model-catalog-option'
import resolveReasoningCapability from '@/services/models/resolve-reasoning-capability'
import resolveSupportsFast from '@/services/models/resolve-fast-capability'

/** Top-level AI SDK `reasoning` omits `max`; providerOptions may still send it. */
export type SdkPortableReasoningLevel = Exclude<ReasoningLevel, 'max'>

export type ReasoningCallMapping = {
  reasoning?: SdkPortableReasoningLevel
  fast?: boolean
  providerOptionsReasoningEffort?: string
  providerOptionsKey?: string
}

const normalizeEffort = (
  value: string | ReasoningLevel | null | undefined,
): ReasoningLevel | undefined => {
  if (!value || !isReasoningLevel(value)) {
    return undefined
  }
  return value
}

/**
 * AI SDK LanguageModelV4CallOptions.reasoning accepts through `xhigh` only.
 * Keep `max` in the UI / catalog; map to `xhigh` for the top-level field.
 * OpenAI providerOptions.reasoningEffort still accepts `max` separately.
 */
const toSdkPortableReasoning = (
  level: ReasoningLevel,
): SdkPortableReasoningLevel => (level === 'max' ? 'xhigh' : level)

const clampEffortForCapability = (
  settings: VixlSettings,
  ref: ModelRef,
  effort: ReasoningLevel | undefined,
): ReasoningLevel | undefined => {
  if (!effort || effort === 'provider-default') {
    return undefined
  }
  const capability = resolveReasoningCapability(settings, ref)
  if (!capability.supported) {
    return undefined
  }
  if (capability.mandatory && effort === 'none') {
    return undefined
  }
  if (!capability.levels.includes(effort)) {
    return undefined
  }
  return effort
}

export const resolveReasoningForRole = (
  role: ModelRoleId,
  settings: VixlSettings,
): ReasoningLevel | undefined => {
  const definition = MODEL_ROLE_REGISTRY.find((entry) => entry.id === role)
  if (!definition?.reasoningSettingsKey) {
    return undefined
  }
  const roleRaw = settings[definition.reasoningSettingsKey]
  const roleValue = normalizeEffort(
    typeof roleRaw === 'string' ? roleRaw : undefined,
  )
  if (roleValue) {
    return roleValue
  }
  if (role === 'default') {
    return undefined
  }
  const defaultRaw = settings['models.defaultReasoning']
  return normalizeEffort(typeof defaultRaw === 'string' ? defaultRaw : undefined)
}

export const resolveCatalogReasoning = (
  settings: VixlSettings,
  ref: ModelRef,
): ReasoningLevel | undefined => {
  const clamped = clampModelCatalogOption(
    settings,
    ref,
    getModelCatalogOption(settings, ref),
  )
  return normalizeEffort(clamped.reasoning)
}

export const pickResolvedReasoning = (
  candidates: Array<string | ReasoningLevel | null | undefined>,
): ReasoningLevel | undefined => {
  for (const candidate of candidates) {
    const normalized = normalizeEffort(candidate)
    if (normalized) {
      return normalized
    }
  }
  return undefined
}

export const mapReasoningToCallOptions = (
  settings: VixlSettings,
  ref: ModelRef,
  reasoning: ReasoningLevel | undefined,
): ReasoningCallMapping => {
  const catalog = clampModelCatalogOption(
    settings,
    ref,
    getModelCatalogOption(settings, ref),
  )
  const customDefault = getCustomProvider(settings, ref.providerId)?.models?.find(
    (entry) => entry.id === ref.modelId,
  )?.reasoningEffort

  const requested =
    reasoning && reasoning !== 'provider-default'
      ? reasoning
      : normalizeEffort(catalog.reasoning) ?? normalizeEffort(customDefault)

  const effective = clampEffortForCapability(settings, ref, requested)

  const mapping: ReasoningCallMapping = {
    fast:
      catalog.fast === true && resolveSupportsFast(ref) ? true : undefined,
  }

  if (!effective) {
    return mapping
  }

  const topLevel = toSdkPortableReasoning(effective)

  if (
    ref.providerId === 'anthropic' ||
    ref.providerId === 'google' ||
    ref.providerId === 'gateway'
  ) {
    return { ...mapping, reasoning: topLevel }
  }

  if (getCustomProvider(settings, ref.providerId)) {
    return {
      ...mapping,
      reasoning: topLevel,
      providerOptionsKey: ref.providerId,
      // Custom / OpenAI-compatible bodies may accept `max` as a string effort.
      providerOptionsReasoningEffort: effective,
    }
  }

  const catalogEntry = getProviderCatalogEntry(ref.providerId)
  if (catalogEntry || ref.providerId === 'openai') {
    return {
      ...mapping,
      reasoning: topLevel,
      providerOptionsKey: 'openai',
      // @ai-sdk/openai providerOptions.reasoningEffort accepts `max`.
      providerOptionsReasoningEffort: effective,
    }
  }

  return {
    ...mapping,
    reasoning: topLevel,
    providerOptionsKey: ref.providerId,
    providerOptionsReasoningEffort: effective,
  }
}

export default mapReasoningToCallOptions
