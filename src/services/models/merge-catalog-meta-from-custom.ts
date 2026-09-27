import type {
  ModelCatalogMeta,
  ModelCatalogMetaMap,
} from '@/types/models/model-catalog-meta'
import type {
  VixlCustomProvider,
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import {
  getModelCatalogMetaMap,
  mergeModelCatalogMeta,
} from '@/services/models/model-catalog-meta'

const CUSTOM_PREFIX = 'providers.custom.'

const customCatalogMeta = (model: VixlCustomProviderModel): ModelCatalogMeta => ({
  contextWindow: model.contextWindow,
  maxOutputTokens: model.maxOutputTokens,
  pricing: model.pricing,
  fastPricing: model.fastPricing,
  vision: model.vision,
  toolCalling: model.toolCalling,
})

const mergeCatalogMetaFromCustomProviders = (
  settings: VixlSettings,
  current: ModelCatalogMetaMap,
): ModelCatalogMetaMap => {
  let working: VixlSettings = {
    ...settings,
    'models.catalogMeta': current,
  }

  for (const [key, value] of Object.entries(settings)) {
    if (!key.startsWith(CUSTOM_PREFIX) || !value || typeof value !== 'object') {
      continue
    }
    const providerId = key.slice(CUSTOM_PREFIX.length)
    if (!providerId) {
      continue
    }
    const models = (value as VixlCustomProvider).models
    if (!models) {
      continue
    }
    for (const model of models) {
      if (!model?.id) {
        continue
      }
      const patch = customCatalogMeta(model)
      working = {
        ...working,
        'models.catalogMeta': mergeModelCatalogMeta(
          working,
          { providerId, modelId: model.id },
          patch,
        ),
      }
    }
  }

  return getModelCatalogMetaMap(working)
}

export default mergeCatalogMetaFromCustomProviders
