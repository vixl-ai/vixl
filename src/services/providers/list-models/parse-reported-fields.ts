import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'

type ReportedModelFields = {
  contextWindow?: number
  maxOutputTokens?: number
  pricing?: ModelPricingRates
  vision?: boolean
  toolCalling?: boolean
}

type PricingKeyMap = {
  input: string
  output: string
  cacheRead: string
  cacheWrite: string
}

const GATEWAY_PRICING_KEYS: PricingKeyMap = {
  input: 'input',
  output: 'output',
  cacheRead: 'input_cache_read',
  cacheWrite: 'input_cache_write',
}

const OPENROUTER_PRICING_KEYS: PricingKeyMap = {
  input: 'prompt',
  output: 'completion',
  cacheRead: 'input_cache_read',
  cacheWrite: 'input_cache_write',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []

const parseFiniteNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return undefined
}

const parsePositiveNumber = (value: unknown): number | undefined => {
  const parsed = parseFiniteNumber(value)
  return parsed !== undefined && parsed > 0 ? parsed : undefined
}

const perTokenToPerMillion = (value: unknown): number | undefined => {
  const parsed = parseFiniteNumber(value)
  if (parsed === undefined || parsed < 0) {
    return undefined
  }
  return parsed * 1_000_000
}

const parsePricingRates = (
  pricing: unknown,
  keys: PricingKeyMap,
): ModelPricingRates | undefined => {
  if (!isRecord(pricing)) {
    return undefined
  }
  const inputPerMillion = perTokenToPerMillion(pricing[keys.input])
  const outputPerMillion = perTokenToPerMillion(pricing[keys.output])
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    return undefined
  }
  const rates: ModelPricingRates = {
    inputPerMillion,
    outputPerMillion,
  }
  const cacheReadPerMillion = perTokenToPerMillion(pricing[keys.cacheRead])
  if (cacheReadPerMillion !== undefined) {
    rates.cacheReadPerMillion = cacheReadPerMillion
  }
  const cacheWritePerMillion = perTokenToPerMillion(pricing[keys.cacheWrite])
  if (cacheWritePerMillion !== undefined) {
    rates.cacheWritePerMillion = cacheWritePerMillion
  }
  return rates
}

const withFlag = (
  fields: ReportedModelFields,
  key: 'vision' | 'toolCalling',
  enabled: boolean,
): void => {
  if (enabled) {
    fields[key] = true
  }
}

const parseGateway = (model: Record<string, unknown>): ReportedModelFields => {
  const fields: ReportedModelFields = {}
  const contextWindow = parsePositiveNumber(model.context_window)
  if (contextWindow !== undefined) {
    fields.contextWindow = contextWindow
  }
  const maxOutputTokens = parsePositiveNumber(model.max_tokens)
  if (maxOutputTokens !== undefined) {
    fields.maxOutputTokens = maxOutputTokens
  }
  const pricing = parsePricingRates(model.pricing, GATEWAY_PRICING_KEYS)
  if (pricing) {
    fields.pricing = pricing
  }
  const tags = stringList(model.tags)
  withFlag(fields, 'vision', tags.includes('vision'))
  withFlag(fields, 'toolCalling', tags.includes('tool-use'))
  return fields
}

const parseOpenRouter = (model: Record<string, unknown>): ReportedModelFields => {
  const fields: ReportedModelFields = {}
  const contextWindow = parsePositiveNumber(model.context_length)
  if (contextWindow !== undefined) {
    fields.contextWindow = contextWindow
  }
  const topProvider = isRecord(model.top_provider) ? model.top_provider : undefined
  const maxOutputTokens = parsePositiveNumber(topProvider?.max_completion_tokens)
  if (maxOutputTokens !== undefined) {
    fields.maxOutputTokens = maxOutputTokens
  }
  const pricing = parsePricingRates(model.pricing, OPENROUTER_PRICING_KEYS)
  if (pricing) {
    fields.pricing = pricing
  }
  const architecture = isRecord(model.architecture) ? model.architecture : undefined
  withFlag(fields, 'vision', stringList(architecture?.input_modalities).includes('image'))
  withFlag(fields, 'toolCalling', stringList(model.supported_parameters).includes('tools'))
  return fields
}

const parseGoogle = (model: Record<string, unknown>): ReportedModelFields => {
  const fields: ReportedModelFields = {}
  const contextWindow = parsePositiveNumber(model.inputTokenLimit)
  if (contextWindow !== undefined) {
    fields.contextWindow = contextWindow
  }
  const maxOutputTokens = parsePositiveNumber(model.outputTokenLimit)
  if (maxOutputTokens !== undefined) {
    fields.maxOutputTokens = maxOutputTokens
  }
  return fields
}

const parseGeneric = (model: Record<string, unknown>): ReportedModelFields => {
  const fields: ReportedModelFields = {}
  const contextWindow =
    parsePositiveNumber(model.context_window) ??
    parsePositiveNumber(model.context_length) ??
    parsePositiveNumber(model.max_model_len)
  if (contextWindow !== undefined) {
    fields.contextWindow = contextWindow
  }
  return fields
}

export default (
  source: 'gateway' | 'openrouter' | 'google' | 'generic',
  model: Record<string, unknown>,
): ReportedModelFields => {
  if (source === 'gateway') {
    return parseGateway(model)
  }
  if (source === 'openrouter') {
    return parseOpenRouter(model)
  }
  if (source === 'google') {
    return parseGoogle(model)
  }
  return parseGeneric(model)
}
