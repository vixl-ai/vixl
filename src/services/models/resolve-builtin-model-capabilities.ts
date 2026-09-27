import type { ModelRef } from '@/types/models/model-ref'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import pickCapabilityDefaultLevel from '@/services/models/pick-capability-default-level'

type BuiltinReasoningCapability = {
  supported: boolean
  levels: ReasoningLevel[]
  mandatory: boolean
  defaultLevel: ReasoningLevel
}

const unsupported = (): BuiltinReasoningCapability => ({
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

const capability = (
  levels: ReasoningLevel[],
  defaultLevel: ReasoningLevel,
  mandatory = false,
): BuiltinReasoningCapability => {
  const withDefault: ReasoningLevel[] = mandatory ? levels : ['provider-default', ...levels]
  const unique = uniqueLevels(withDefault)
  return {
    supported: true,
    levels: unique,
    mandatory,
    defaultLevel: pickCapabilityDefaultLevel(unique, defaultLevel),
  }
}

/**
 * Strip common dated aliases so prefix rules can match sparse families.
 * Handles `-YYYYMMDD` (e.g. gpt-5.1-20251015) and `-YYYY-MM-DD`.
 */
const normalizeModelId = (modelId: string): string => {
  const lower = modelId.trim().toLowerCase()
  return lower.replace(/-\d{8}$/, '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
}

/**
 * OpenAI reasoning effort subsets.
 * Docs: https://platform.openai.com/docs/guides/reasoning
 * Model params reference: https://modelparams.dev
 *
 * Intentionally sparse: unknown o-series or gpt-5 ids fall back to unsupported.
 */
const resolveOpenaiReasoning = (modelId: string): BuiltinReasoningCapability => {
  const id = normalizeModelId(modelId)

  if (
    id.startsWith('gpt-5.1-codex') ||
    id.startsWith('gpt-5.2-codex') ||
    id.startsWith('gpt-5.3-codex')
  ) {
    return capability(['medium', 'high', 'xhigh'], 'medium')
  }

  if (id === 'gpt-5-pro' || id.startsWith('gpt-5-pro-')) {
    return capability(['high'], 'high', true)
  }

  if (id.startsWith('gpt-5.6')) {
    return capability(['none', 'low', 'medium', 'high', 'xhigh', 'max'], 'none')
  }

  if (
    id.startsWith('gpt-5.2') ||
    id.startsWith('gpt-5.3') ||
    id.startsWith('gpt-5.4') ||
    id.startsWith('gpt-5.5')
  ) {
    return capability(['none', 'low', 'medium', 'high', 'xhigh'], 'none')
  }

  if (id === 'gpt-5.1' || id.startsWith('gpt-5.1-')) {
    return capability(['none', 'low', 'medium', 'high'], 'none')
  }

  if (id === 'gpt-5' || id.startsWith('gpt-5-mini') || id.startsWith('gpt-5-nano')) {
    return capability(['minimal', 'low', 'medium', 'high'], 'medium')
  }

  // o3 / o3-pro (and dated aliases). Other o3-* variants are not enumerated.
  if (id === 'o3' || id.startsWith('o3-pro')) {
    return capability(['low', 'medium', 'high', 'xhigh'], 'medium')
  }

  if (id.startsWith('o4-mini')) {
    return capability(['low', 'medium', 'high', 'xhigh'], 'medium')
  }

  if (id.startsWith('o1-mini') || id.startsWith('o1-preview')) {
    return capability(['minimal', 'low', 'medium', 'high'], 'medium')
  }

  return unsupported()
}

/**
 * Anthropic effort controls (Claude 4.6+ / 5.x and opus-4-5 extended thinking).
 * Docs: https://docs.anthropic.com/en/docs/build-with-claude/effort
 *
 * Intentionally sparse: Haiku and older Sonnet/Opus fall back to unsupported.
 */
const resolveAnthropicReasoning = (modelId: string): BuiltinReasoningCapability => {
  const id = normalizeModelId(modelId)

  if (
    id.startsWith('claude-opus-5') ||
    id.startsWith('claude-sonnet-5') ||
    id.startsWith('claude-fable-5') ||
    id.startsWith('claude-mythos-5') ||
    id.startsWith('claude-mythos-preview')
  ) {
    return capability(['low', 'medium', 'high', 'xhigh', 'max'], 'high')
  }

  if (id.startsWith('claude-opus-4-7') || id.startsWith('claude-opus-4-8')) {
    return capability(['low', 'medium', 'high', 'xhigh', 'max'], 'high')
  }

  if (id.startsWith('claude-opus-4-6') || id.startsWith('claude-sonnet-4-6')) {
    return capability(['low', 'medium', 'high', 'xhigh'], 'high')
  }

  if (id.startsWith('claude-opus-4-5')) {
    return capability(['low', 'medium', 'high', 'xhigh'], 'high')
  }

  return unsupported()
}

/**
 * Gemini thinking / reasoning effort families.
 * Docs: https://ai.google.dev/gemini-api/docs/thinking
 *
 * Intentionally sparse: older Gemini ids fall back to unsupported.
 */
const resolveGoogleReasoning = (modelId: string): BuiltinReasoningCapability => {
  const id = normalizeModelId(modelId)

  if (id.startsWith('gemini-3.1-flash-lite-image')) {
    return capability(['minimal', 'high'], 'high')
  }

  if (id.startsWith('gemini-3.1-pro-preview')) {
    return capability(['low', 'medium', 'high'], 'high')
  }

  if (id.startsWith('gemini-3')) {
    return capability(['minimal', 'low', 'medium', 'high'], 'high')
  }

  if (
    id.startsWith('gemini-2.5-flash-lite') ||
    id.startsWith('gemini-2.5-flash') ||
    id.startsWith('gemini-2.5-pro')
  ) {
    return capability(['low', 'medium', 'high'], 'medium')
  }

  return unsupported()
}

const resolveFamily = (family: string, modelId: string): BuiltinReasoningCapability => {
  switch (family) {
    case 'openai':
      return resolveOpenaiReasoning(modelId)
    case 'anthropic':
      return resolveAnthropicReasoning(modelId)
    case 'google':
      return resolveGoogleReasoning(modelId)
    default:
      return unsupported()
  }
}

/**
 * Sparse id-pattern reasoning capability for native catalogs and
 * gateway/openrouter fallbacks when live effort metadata is absent.
 */
export const resolveBuiltinReasoningCapability = (ref: ModelRef): BuiltinReasoningCapability => {
  const providerId = ref.providerId.trim().toLowerCase()
  const rawModelId = ref.modelId.trim()

  if (providerId === 'gateway' || providerId === 'openrouter') {
    const slash = rawModelId.indexOf('/')
    if (slash <= 0 || slash >= rawModelId.length - 1) {
      return unsupported()
    }
    const family = rawModelId.slice(0, slash).toLowerCase()
    const modelId = rawModelId.slice(slash + 1)
    return resolveFamily(family, modelId)
  }

  return resolveFamily(providerId, rawModelId)
}

export default resolveBuiltinReasoningCapability
