import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type {
  KeyValueRow,
  ModelDraft,
  PricingDraft,
  VixlCustomProviderModel,
} from './types'

export const createEmptyPricing = (): PricingDraft => ({
  inputPerMillion: '',
  outputPerMillion: '',
  cacheReadPerMillion: '',
  cacheWritePerMillion: '',
  reasoningPerMillion: '',
})

export const createEmptyModel = (): ModelDraft => ({
  id: '',
  name: '',
  maxInputTokens: '',
  maxOutputTokens: '',
  contextWindow: '',
  toolCalling: true,
  vision: false,
  thinking: false,
  streaming: true,
  supportsReasoningEffort: '',
  reasoningEffort: '',
  temperature: '',
  topP: '',
  topK: '',
  frequencyPenalty: '',
  presencePenalty: '',
  seed: '',
  headers: [],
  modelOptionsJson: '',
  pricing: createEmptyPricing(),
  advancedOpen: false,
})

/** Custom openai-compatible providers have no gateway/OpenRouter cost path. */
export const hasProviderCostPath = false

const toDraftText = (value: string | number | null | undefined): string => {
  if (value === null || value === undefined) {
    return ''
  }
  return String(value)
}

export const modelHasPricingConfigured = (draft: ModelDraft): boolean => {
  const pricing = draft.pricing
  return (
    toDraftText(pricing.inputPerMillion).trim().length > 0 ||
    toDraftText(pricing.outputPerMillion).trim().length > 0 ||
    toDraftText(pricing.cacheReadPerMillion).trim().length > 0 ||
    toDraftText(pricing.cacheWritePerMillion).trim().length > 0 ||
    toDraftText(pricing.reasoningPerMillion).trim().length > 0
  )
}

export const showPricingWarning = (draft: ModelDraft): boolean =>
  !hasProviderCostPath && !modelHasPricingConfigured(draft)

export const pricingToDraft = (pricing?: ModelPricingRates): PricingDraft => {
  if (!pricing) {
    return createEmptyPricing()
  }
  return {
    inputPerMillion: pricing.inputPerMillion.toString(),
    outputPerMillion: pricing.outputPerMillion.toString(),
    cacheReadPerMillion: pricing.cacheReadPerMillion?.toString() ?? '',
    cacheWritePerMillion: pricing.cacheWritePerMillion?.toString() ?? '',
    reasoningPerMillion: pricing.reasoningPerMillion?.toString() ?? '',
  }
}

export const parseOptionalNumber = (value: string | number): number | undefined => {
  const trimmed = toDraftText(value).trim()
  if (!trimmed) {
    return undefined
  }
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number: ${trimmed}`)
  }
  return parsed
}

export const draftToPricing = (draft: PricingDraft): ModelPricingRates | undefined => {
  if (
    !toDraftText(draft.inputPerMillion).trim() &&
    !toDraftText(draft.outputPerMillion).trim() &&
    !toDraftText(draft.cacheReadPerMillion).trim() &&
    !toDraftText(draft.cacheWritePerMillion).trim() &&
    !toDraftText(draft.reasoningPerMillion).trim()
  ) {
    return undefined
  }

  const inputPerMillion = parseOptionalNumber(draft.inputPerMillion)
  const outputPerMillion = parseOptionalNumber(draft.outputPerMillion)
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    throw new Error(
      'Pricing requires both Input $/1M and Output $/1M when any pricing field is set',
    )
  }

  const rates: ModelPricingRates = {
    inputPerMillion,
    outputPerMillion,
  }
  const cacheReadPerMillion = parseOptionalNumber(draft.cacheReadPerMillion)
  if (cacheReadPerMillion !== undefined) {
    rates.cacheReadPerMillion = cacheReadPerMillion
  }
  const cacheWritePerMillion = parseOptionalNumber(draft.cacheWritePerMillion)
  if (cacheWritePerMillion !== undefined) {
    rates.cacheWritePerMillion = cacheWritePerMillion
  }
  const reasoningPerMillion = parseOptionalNumber(draft.reasoningPerMillion)
  if (reasoningPerMillion !== undefined) {
    rates.reasoningPerMillion = reasoningPerMillion
  }
  return rates
}

export const recordToRows = (record?: Record<string, string>): KeyValueRow[] => {
  if (!record) {
    return []
  }
  return Object.entries(record).map(([key, value]) => ({ key, value }))
}

export const rowsToRecord = (rows: KeyValueRow[]): Record<string, string> | undefined => {
  const next: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (!key) {
      continue
    }
    next[key] = row.value
  }
  return Object.keys(next).length > 0 ? next : undefined
}

export const modelToDraft = (model: VixlCustomProviderModel): ModelDraft => ({
  id: model.id,
  name: model.name ?? '',
  maxInputTokens: model.maxInputTokens?.toString() ?? '',
  maxOutputTokens: model.maxOutputTokens?.toString() ?? '',
  contextWindow: model.contextWindow?.toString() ?? '',
  toolCalling: model.toolCalling ?? true,
  vision: model.vision ?? false,
  thinking: model.thinking ?? false,
  streaming: model.streaming ?? true,
  supportsReasoningEffort: model.supportsReasoningEffort?.join(', ') ?? '',
  reasoningEffort: model.reasoningEffort ?? '',
  temperature: model.temperature?.toString() ?? '',
  topP: model.topP?.toString() ?? '',
  topK: model.topK?.toString() ?? '',
  frequencyPenalty: model.frequencyPenalty?.toString() ?? '',
  presencePenalty: model.presencePenalty?.toString() ?? '',
  seed: model.seed?.toString() ?? '',
  headers: recordToRows(model.headers),
  modelOptionsJson: model.modelOptions ? JSON.stringify(model.modelOptions, null, 2) : '',
  pricing: pricingToDraft(model.pricing),
  advancedOpen: false,
})

export const draftToModel = (draft: ModelDraft): VixlCustomProviderModel => {
  const model: VixlCustomProviderModel = {
    id: draft.id.trim(),
  }
  if (draft.name.trim()) {
    model.name = draft.name.trim()
  }
  const maxInputTokens = parseOptionalNumber(draft.maxInputTokens)
  if (maxInputTokens !== undefined) {
    model.maxInputTokens = maxInputTokens
  }
  const maxOutputTokens = parseOptionalNumber(draft.maxOutputTokens)
  if (maxOutputTokens !== undefined) {
    model.maxOutputTokens = maxOutputTokens
  }
  const contextWindow = parseOptionalNumber(draft.contextWindow)
  if (contextWindow !== undefined) {
    model.contextWindow = contextWindow
  }
  model.toolCalling = draft.toolCalling
  model.vision = draft.vision
  model.thinking = draft.thinking
  model.streaming = draft.streaming
  const efforts = draft.supportsReasoningEffort
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  if (efforts.length > 0) {
    model.supportsReasoningEffort = efforts
  }
  if (draft.reasoningEffort.trim()) {
    model.reasoningEffort = draft.reasoningEffort.trim()
  }
  const temperature = parseOptionalNumber(draft.temperature)
  if (temperature !== undefined) {
    model.temperature = temperature
  }
  const topP = parseOptionalNumber(draft.topP)
  if (topP !== undefined) {
    model.topP = topP
  }
  const topK = parseOptionalNumber(draft.topK)
  if (topK !== undefined) {
    model.topK = topK
  }
  const frequencyPenalty = parseOptionalNumber(draft.frequencyPenalty)
  if (frequencyPenalty !== undefined) {
    model.frequencyPenalty = frequencyPenalty
  }
  const presencePenalty = parseOptionalNumber(draft.presencePenalty)
  if (presencePenalty !== undefined) {
    model.presencePenalty = presencePenalty
  }
  const seed = parseOptionalNumber(draft.seed)
  if (seed !== undefined) {
    model.seed = seed
  }
  const modelHeaders = rowsToRecord(draft.headers)
  if (modelHeaders) {
    model.headers = modelHeaders
  }
  if (draft.modelOptionsJson.trim()) {
    const parsed = JSON.parse(draft.modelOptionsJson) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Model ${draft.id || '(unnamed)'}: modelOptions must be a JSON object`)
    }
    model.modelOptions = parsed as Record<string, unknown>
  }
  const pricing = draftToPricing(draft.pricing)
  if (pricing) {
    model.pricing = pricing
  }
  return model
}
