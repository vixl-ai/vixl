import type { ModelRef } from '@/types/models/model-ref'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type {
  VixlCustomProvider,
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import { getCustomProvider } from '@/services/providers/registry'
import {
  mapReasoningToCallOptions,
  type SdkPortableReasoningLevel,
} from '@/services/models/resolve-reasoning-for-call'
import resolveSupportsFast from '@/services/models/resolve-fast-capability'
import applyAnthropicPromptCache from '@/services/models/apply-anthropic-prompt-cache'

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
type JsonObject = { [key: string]: JsonValue }

export type ResolvedModelCallOptions = {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  /** Top-level AI SDK reasoning (no `max`; mapped to `xhigh` when needed). */
  reasoning?: SdkPortableReasoningLevel
  providerOptions?: Record<string, JsonObject>
}

export type ResolvedModelContextLimits = {
  maxInputTokens?: number
  maxOutputTokens?: number
}

const DEFAULT_MAX_OUTPUT_TOKENS = 8192
const DEFAULT_SIDE_TASK_MAX_OUTPUT_TOKENS = 256

const applyFastOption = (
  options: ResolvedModelCallOptions,
  ref: ModelRef,
  fast: boolean | undefined,
): void => {
  if (!fast) {
    return
  }
  // AI Gateway: providerOptions.gateway.speed. Anthropic native: anthropic.speed.
  // Other providers use a -fast model id rewrite in resolveModelRefForCall.
  const key =
    ref.providerId === 'gateway'
      ? 'gateway'
      : ref.providerId === 'anthropic'
        ? 'anthropic'
        : null
  if (!key) {
    return
  }
  const existing = options.providerOptions?.[key] ?? {}
  options.providerOptions = {
    ...options.providerOptions,
    [key]: {
      ...existing,
      speed: 'fast',
    },
  }
}

export const getCustomProviderModel = (
  settings: VixlSettings,
  ref: ModelRef,
): { provider: VixlCustomProvider; model: VixlCustomProviderModel } | null => {
  const provider = getCustomProvider(settings, ref.providerId)
  if (!provider?.models?.length) {
    return null
  }
  const model = provider.models.find((entry) => entry.id === ref.modelId)
  if (!model) {
    return null
  }
  return { provider, model }
}

export const resolveContextWindow = (
  settings: VixlSettings,
  ref: ModelRef,
): number | undefined => {
  const matched = getCustomProviderModel(settings, ref)
  if (!matched) {
    return undefined
  }
  const { model } = matched
  if (typeof model.contextWindow === 'number' && model.contextWindow > 0) {
    return model.contextWindow
  }
  if (typeof model.maxInputTokens === 'number' && model.maxInputTokens > 0) {
    return model.maxInputTokens
  }
  return undefined
}

export const resolveMaxInputTokens = (
  settings: VixlSettings,
  ref: ModelRef,
): number | undefined => {
  const matched = getCustomProviderModel(settings, ref)
  if (!matched) {
    return undefined
  }
  const { model } = matched
  if (typeof model.maxInputTokens === 'number') {
    return model.maxInputTokens
  }
  if (typeof model.contextWindow === 'number') {
    const maxOutput = model.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
    const derived = model.contextWindow - maxOutput
    return derived > 0 ? derived : model.contextWindow
  }
  return undefined
}

export const resolveModelCallOptions = (
  settings: VixlSettings,
  ref: ModelRef,
  defaults?: { maxOutputTokens?: number; reasoning?: ReasoningLevel },
): ResolvedModelCallOptions => {
  const fallbackMaxOutput = defaults?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  const matched = getCustomProviderModel(settings, ref)
  const reasoningMapping = mapReasoningToCallOptions(settings, ref, defaults?.reasoning)

  if (!matched) {
    const options: ResolvedModelCallOptions = {
      maxOutputTokens: fallbackMaxOutput,
    }
    if (reasoningMapping.reasoning) {
      options.reasoning = reasoningMapping.reasoning
    }
    if (
      reasoningMapping.providerOptionsKey &&
      reasoningMapping.providerOptionsReasoningEffort
    ) {
      options.providerOptions = {
        [reasoningMapping.providerOptionsKey]: {
          reasoningEffort: reasoningMapping.providerOptionsReasoningEffort,
        },
      }
    }
    applyFastOption(
      options,
      ref,
      resolveSupportsFast(ref) ? reasoningMapping.fast : undefined,
    )
    applyAnthropicPromptCache(options, ref)
    return options
  }

  const { model } = matched
  const options: ResolvedModelCallOptions = {
    maxOutputTokens: model.maxOutputTokens ?? fallbackMaxOutput,
  }

  if (typeof model.temperature === 'number') {
    options.temperature = model.temperature
  }
  if (typeof model.topP === 'number') {
    options.topP = model.topP
  }
  if (typeof model.topK === 'number') {
    options.topK = model.topK
  }
  if (typeof model.frequencyPenalty === 'number') {
    options.frequencyPenalty = model.frequencyPenalty
  }
  if (typeof model.presencePenalty === 'number') {
    options.presencePenalty = model.presencePenalty
  }
  if (typeof model.seed === 'number') {
    options.seed = model.seed
  }

  const providerOptionsBody: JsonObject = {}
  if (model.modelOptions) {
    for (const [key, value] of Object.entries(model.modelOptions)) {
      providerOptionsBody[key] = value as JsonValue
    }
  }

  const effortFromMapping = reasoningMapping.providerOptionsReasoningEffort
  const effortFromModel =
    !defaults?.reasoning || defaults.reasoning === 'provider-default'
      ? model.reasoningEffort
      : undefined
  const effort = effortFromMapping ?? effortFromModel
  if (effort) {
    const key = reasoningMapping.providerOptionsKey ?? ref.providerId
    providerOptionsBody.reasoningEffort = effort
    options.providerOptions = {
      [key]: providerOptionsBody,
    }
  } else if (Object.keys(providerOptionsBody).length > 0) {
    options.providerOptions = {
      [ref.providerId]: providerOptionsBody,
    }
  }

  if (reasoningMapping.reasoning) {
    options.reasoning = reasoningMapping.reasoning
  }

  applyFastOption(
    options,
    ref,
    resolveSupportsFast(ref) ? reasoningMapping.fast : undefined,
  )
  applyAnthropicPromptCache(options, ref)
  return options
}

export const resolveSideTaskCallOptions = (
  settings: VixlSettings,
  ref: ModelRef,
): ResolvedModelCallOptions =>
  resolveModelCallOptions(settings, ref, {
    maxOutputTokens: DEFAULT_SIDE_TASK_MAX_OUTPUT_TOKENS,
    reasoning: 'none',
  })

export { DEFAULT_MAX_OUTPUT_TOKENS, DEFAULT_SIDE_TASK_MAX_OUTPUT_TOKENS }
