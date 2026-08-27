import type {
  ModelCatalogMeta,
  ModelCatalogMetaMap,
} from '@/types/models/model-catalog-meta'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import serializeModelRef from '@/utils/serialize-model-ref'

const serializedKey = (ref: ModelRef | string): string =>
  typeof ref === 'string'
    ? ref
    : serializeModelRef({ providerId: ref.providerId, modelId: ref.modelId })

const omitNonPositiveInt = (
  next: ModelCatalogMeta,
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

export const getModelCatalogMetaMap = (
  settings: VixlSettings,
): ModelCatalogMetaMap => {
  const raw = settings['models.catalogMeta']
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return raw as ModelCatalogMetaMap
}

export const getModelCatalogMeta = (
  settings: VixlSettings,
  ref: ModelRef | string,
): ModelCatalogMeta => getModelCatalogMetaMap(settings)[serializedKey(ref)] ?? {}

export const mergeModelCatalogMeta = (
  settings: VixlSettings,
  ref: ModelRef | string,
  patch: ModelCatalogMeta,
): ModelCatalogMetaMap => {
  const key = serializedKey(ref)
  const current = getModelCatalogMetaMap(settings)
  const next: ModelCatalogMeta = { ...current[key] }

  for (const [field, value] of Object.entries(patch) as Array<
    [keyof ModelCatalogMeta, ModelCatalogMeta[keyof ModelCatalogMeta]]
  >) {
    if (value === undefined) {
      delete next[field]
      continue
    }
    next[field] = value as never
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

export default getModelCatalogMeta
