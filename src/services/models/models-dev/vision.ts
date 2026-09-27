import type { ModelRef } from '@/types/models/model-ref'
import loadModelsDevCatalog from '@/services/models/models-dev/catalog'
import { lookupModelsDevModel } from '@/services/models/models-dev/provider-keys'

/**
 * Resolve vision from models.dev `modalities.input`.
 * Returns true, false, or undefined (unknown / fetch miss).
 */
const resolveModelsDevVision = async (
  ref: Pick<ModelRef, 'providerId' | 'modelId'>,
): Promise<boolean | undefined> => {
  const catalog = await loadModelsDevCatalog()
  if (!catalog) {
    return undefined
  }

  const input = lookupModelsDevModel(catalog, ref.providerId, ref.modelId)
    ?.modalities?.input
  if (!input) {
    return undefined
  }
  return input.includes('image')
}

export default resolveModelsDevVision
