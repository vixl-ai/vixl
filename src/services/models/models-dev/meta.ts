import type {
  ModelsDevCatalog,
  ModelsDevCost,
  ModelsDevModel,
} from '@/schemas/models/models-dev-catalog'
import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type {
  ModelCatalogMeta,
  ModelCatalogMetaMap,
} from '@/types/models/model-catalog-meta'
import type { ModelRef } from '@/types/models/model-ref'
import { lookupModelsDevModel } from '@/services/models/models-dev/provider-keys'
import serializeModelRef from '@/utils/serialize-model-ref'

const CATALOG_META_FIELDS = [
  'contextWindow',
  'maxOutputTokens',
  'pricing',
  'fastPricing',
  'vision',
  'toolCalling',
] as const satisfies ReadonlyArray<keyof ModelCatalogMeta>

const nonNegativeFinite = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return undefined
  }
  return value
}

const positiveInt = (value: number | undefined): number | undefined => {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return undefined
  }
  return value
}

const toPricingRates = (cost: ModelsDevCost | undefined): ModelPricingRates | undefined => {
  if (!cost) {
    return undefined
  }
  const inputPerMillion = nonNegativeFinite(cost.input)
  const outputPerMillion = nonNegativeFinite(cost.output)
  if (inputPerMillion === undefined || outputPerMillion === undefined) {
    return undefined
  }
  const rates: ModelPricingRates = {
    inputPerMillion,
    outputPerMillion,
  }
  const cacheReadPerMillion = nonNegativeFinite(cost.cache_read)
  if (cacheReadPerMillion !== undefined) {
    rates.cacheReadPerMillion = cacheReadPerMillion
  }
  const cacheWritePerMillion = nonNegativeFinite(cost.cache_write)
  if (cacheWritePerMillion !== undefined) {
    rates.cacheWritePerMillion = cacheWritePerMillion
  }
  const reasoningPerMillion = nonNegativeFinite(cost.reasoning)
  if (reasoningPerMillion !== undefined) {
    rates.reasoningPerMillion = reasoningPerMillion
  }
  return rates
}

const isFastModeName = (name: string): boolean => name.trim().toLowerCase().includes('fast')

const fastModeCost = (
  modes: Record<string, { cost?: ModelsDevCost }> | undefined,
): ModelsDevCost | undefined => {
  if (!modes) {
    return undefined
  }
  const entries = Object.entries(modes)
  const exact = entries.find(([name]) => name.trim().toLowerCase() === 'fast')
  if (exact) {
    return exact[1]?.cost
  }
  const like = entries.find(([name]) => isFastModeName(name))
  return like?.[1]?.cost
}

const catalogMetaFromModel = (model: ModelsDevModel): ModelCatalogMeta => {
  const patch: ModelCatalogMeta = {}
  const contextWindow = positiveInt(model.limit?.context)
  if (contextWindow !== undefined) {
    patch.contextWindow = contextWindow
  }
  const maxOutputTokens = positiveInt(model.limit?.output)
  if (maxOutputTokens !== undefined) {
    patch.maxOutputTokens = maxOutputTokens
  }
  const pricing = toPricingRates(model.cost)
  if (pricing) {
    patch.pricing = pricing
  }
  const fastPricing = toPricingRates(fastModeCost(model.experimental?.modes))
  if (fastPricing) {
    patch.fastPricing = fastPricing
  }
  const input = model.modalities?.input
  if (input) {
    patch.vision = input.includes('image')
  }
  if (typeof model.tool_call === 'boolean') {
    patch.toolCalling = model.tool_call
  }
  return patch
}

export const catalogMetaFromModelsDev = (
  catalog: ModelsDevCatalog,
  refs: Array<Pick<ModelRef, 'providerId' | 'modelId'>>,
): ModelCatalogMetaMap => {
  const patches: ModelCatalogMetaMap = {}
  for (const ref of refs) {
    const model = lookupModelsDevModel(catalog, ref.providerId, ref.modelId)
    if (!model) {
      continue
    }
    const patch = catalogMetaFromModel(model)
    if (Object.keys(patch).length === 0) {
      continue
    }
    patches[serializeModelRef(ref)] = patch
  }
  return patches
}

export const fillCatalogMetaGaps = (
  current: ModelCatalogMetaMap,
  patches: ModelCatalogMetaMap,
): ModelCatalogMetaMap => {
  let next: ModelCatalogMetaMap | undefined
  for (const [key, patch] of Object.entries(patches)) {
    const existing = current[key] ?? {}
    const filled: ModelCatalogMeta = { ...existing }
    let changed = false
    for (const field of CATALOG_META_FIELDS) {
      if (filled[field] !== undefined) {
        continue
      }
      const value = patch[field]
      if (value === undefined) {
        continue
      }
      filled[field] = value as never
      changed = true
    }
    if (!changed || Object.keys(filled).length === 0) {
      continue
    }
    if (!next) {
      next = { ...current }
    }
    next[key] = filled
  }
  return next ?? current
}

const mergeModelsDevCatalogMeta = (
  current: ModelCatalogMetaMap,
  catalog: ModelsDevCatalog,
  refs: Array<Pick<ModelRef, 'providerId' | 'modelId'>>,
): ModelCatalogMetaMap =>
  fillCatalogMetaGaps(current, catalogMetaFromModelsDev(catalog, refs))

export default mergeModelsDevCatalogMeta
