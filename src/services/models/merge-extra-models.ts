import type { ProviderModelGroup } from '@/types/models/provider-model-group'

const mergeExtraModels = (
  groups: ProviderModelGroup[],
  extraRefs: string[],
): ProviderModelGroup[] => {
  if (extraRefs.length === 0) {
    return groups
  }

  const next = groups.map((group) => ({
    ...group,
    models: [...group.models],
  }))
  const groupByProvider = new Map(next.map((group) => [group.providerId, group]))

  for (const serialized of extraRefs) {
    const separatorIndex = serialized.indexOf('::')
    if (separatorIndex <= 0) {
      continue
    }
    const providerId = serialized.slice(0, separatorIndex)
    const modelId = serialized.slice(separatorIndex + 2)
    if (!providerId || !modelId) {
      continue
    }

    const existing = groupByProvider.get(providerId)
    const modelRef = { providerId, modelId }
    if (existing) {
      const alreadyPresent = existing.models.some(
        (model) => model.providerId === providerId && model.modelId === modelId,
      )
      if (!alreadyPresent) {
        existing.models.unshift(modelRef)
      }
      continue
    }

    const created: ProviderModelGroup = {
      providerId,
      providerName: providerId,
      models: [modelRef],
    }
    next.push(created)
    groupByProvider.set(providerId, created)
  }

  return next.sort((left, right) => left.providerName.localeCompare(right.providerName))
}

export default mergeExtraModels
