import type {
  ModelCatalogMeta,
  ModelCatalogMetaMap,
} from '@/types/models/model-catalog-meta'
import type { ModelRef } from '@/types/models/model-ref'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import {
  getModelCatalogMetaMap,
  mergeModelCatalogMeta,
} from '@/services/models/model-catalog-meta'

const reportedCatalogMeta = (model: ModelRef): ModelCatalogMeta => {
  const patch: ModelCatalogMeta = {}
  if (model.contextWindow !== undefined) {
    patch.contextWindow = model.contextWindow
  }
  if (model.maxOutputTokens !== undefined) {
    patch.maxOutputTokens = model.maxOutputTokens
  }
  if (model.pricing !== undefined) {
    patch.pricing = model.pricing
  }
  if (model.vision !== undefined) {
    patch.vision = model.vision
  }
  if (model.toolCalling !== undefined) {
    patch.toolCalling = model.toolCalling
  }
  return patch
}

const mergeCatalogMetaFromGroups = (
  settings: VixlSettings,
  groups: ProviderModelGroup[],
): ModelCatalogMetaMap => {
  let working: VixlSettings = settings

  for (const group of groups) {
    for (const model of group.models) {
      const patch = reportedCatalogMeta(model)
      if (Object.keys(patch).length === 0) {
        continue
      }
      working = {
        ...working,
        'models.catalogMeta': mergeModelCatalogMeta(working, model, patch),
      }
    }
  }

  return getModelCatalogMetaMap(working)
}

export default mergeCatalogMetaFromGroups
