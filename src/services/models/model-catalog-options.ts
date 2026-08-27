import type {
  ModelCatalogOption,
  ModelCatalogOptionsMap,
} from '@/types/models/model-catalog-option'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import serializeModelRef from '@/utils/serialize-model-ref'
import type { ModelRef } from '@/types/models/model-ref'
import clampModelCatalogOption from '@/services/models/clamp-model-catalog-option'

const omitNonPositiveInt = (
  next: ModelCatalogOption,
  field: 'contextWindow' | 'maxOutputTokens',
): void => {
  const value = next[field]
  if (value === undefined) {
    return
  }
  if (!Number.isInteger(value) || value <= 0) {
    delete next[field]
  }
}

export const getModelCatalogOptionsMap = (
  settings: VixlSettings,
): ModelCatalogOptionsMap => {
  const raw = settings['models.catalogOptions']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return raw as ModelCatalogOptionsMap
}

export const getModelCatalogOption = (
  settings: VixlSettings,
  ref: ModelRef | string,
): ModelCatalogOption => {
  const key =
    typeof ref === 'string'
      ? ref
      : serializeModelRef({ providerId: ref.providerId, modelId: ref.modelId })
  return getModelCatalogOptionsMap(settings)[key] ?? {}
}

/**
 * Read path for UI: stored option clamped to the model's current capabilities.
 * Prefer this over getModelCatalogOption when displaying or deriving labels.
 * Saves still go through mergeModelCatalogOption with the raw patch.
 */
export const getClampedModelCatalogOption = (
  settings: VixlSettings,
  ref: ModelRef,
): ModelCatalogOption =>
  clampModelCatalogOption(settings, ref, getModelCatalogOption(settings, ref))

export const isModelAllowed = (
  settings: VixlSettings,
  ref: ModelRef | string,
): boolean => getModelCatalogOption(settings, ref).allowed !== false

export const mergeModelCatalogOption = (
  settings: VixlSettings,
  ref: ModelRef | string,
  patch: ModelCatalogOption,
): ModelCatalogOptionsMap => {
  const key =
    typeof ref === 'string'
      ? ref
      : serializeModelRef({ providerId: ref.providerId, modelId: ref.modelId })
  const current = getModelCatalogOptionsMap(settings)
  const next: ModelCatalogOption = { ...current[key] }

  for (const [field, value] of Object.entries(patch) as Array<
    [keyof ModelCatalogOption, ModelCatalogOption[keyof ModelCatalogOption]]
  >) {
    if (value === undefined) {
      delete next[field]
      continue
    }
    next[field] = value as never
  }

  if (next.reasoning === 'provider-default') {
    delete next.reasoning
  }
  if (next.allowed === true) {
    delete next.allowed
  }
  if (next.fast === false) {
    delete next.fast
  }
  omitNonPositiveInt(next, 'contextWindow')
  omitNonPositiveInt(next, 'maxOutputTokens')

  const map = { ...current }
  if (Object.keys(next).length === 0) {
    delete map[key]
  } else {
    map[key] = next
  }
  return map
}

export default getModelCatalogOption
