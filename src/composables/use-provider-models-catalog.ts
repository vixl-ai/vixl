import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import useVixlConfig from '@/composables/use-vixl-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import listAllProviderModels from '@/services/providers/list-all-provider-models'
import collapseProviderModelGroups from '@/services/models/collapse-provider-model-groups'
import mergeCatalogMetaFromGroups from '@/services/models/merge-catalog-meta-from-groups'
import { getModelCatalogMetaMap } from '@/services/models/model-catalog-meta'
import { filterProviderModelGroups } from '@/services/models/search'
import serializeModelRef from '@/utils/serialize-model-ref'
import formatModelRefLabel from '@/utils/format-model-ref-label'
import formatUnknownError from '@/utils/format-unknown-error'
import { canonicalizeModelRef } from '@/services/models/resolve-model-ref-for-call'
import parseModelRef from '@/utils/parse-model-ref'

export type UseProviderModelsCatalogOptions = {
  settings: Ref<VixlSettings> | ComputedRef<VixlSettings>
  extraModelRefs?: Ref<string[]> | ComputedRef<string[]>
}

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

export default (options: UseProviderModelsCatalogOptions) => {
  const config = useVixlConfig()
  const groups = ref<ProviderModelGroup[]>([])
  const loading = ref(false)
  let loadGeneration = 0

  const persistCatalogMeta = async (
    listed: ProviderModelGroup[],
    generation: number,
  ): Promise<void> => {
    const personal = config.personalSettings.value
    const nextMeta = mergeCatalogMetaFromGroups(personal, listed)
    const currentMeta = getModelCatalogMetaMap(personal)
    if (
      generation !== loadGeneration ||
      JSON.stringify(currentMeta) === JSON.stringify(nextMeta)
    ) {
      return
    }
    try {
      await config.updateSetting('personal', 'models.catalogMeta', nextMeta)
    } catch (error) {
      toast.error('Failed to save catalog metadata', {
        description: formatUnknownError(error),
      })
    }
  }

  const settingsFingerprint = computed(() => {
    const settings = options.settings.value
    const providerKeys = Object.keys(settings)
      .filter(
        (key) =>
          (key.startsWith('providers.') && key.endsWith('.apiKeyRef')) ||
          key.startsWith('providers.custom.'),
      )
      .sort()
    const customPayload = providerKeys
      .filter((key) => key.startsWith('providers.custom.'))
      .map((key) => JSON.stringify(settings[key as keyof typeof settings] ?? null))
      .join('|')
    return `${providerKeys.join('|')}::${customPayload}`
  })

  const refresh = async (): Promise<void> => {
    const generation = ++loadGeneration
    loading.value = true

    try {
      const loaded = await listAllProviderModels(options.settings.value)
      if (generation !== loadGeneration) {
        return
      }
      const extra = options.extraModelRefs?.value ?? []
      groups.value = collapseProviderModelGroups(mergeExtraModels(loaded, extra))
      await persistCatalogMeta(loaded, generation)
    } finally {
      if (generation === loadGeneration) {
        loading.value = false
      }
    }
  }

  const filterGroups = (query: string): ProviderModelGroup[] =>
    filterProviderModelGroups(groups.value, query)

  const hasProviders = computed(() => groups.value.length > 0)

  const labelForSerialized = (serialized: string): string => {
    const parsed = parseModelRef(serialized)
    if (!parsed) {
      return serialized
    }
    const canonical = canonicalizeModelRef(parsed)
    for (const group of groups.value) {
      if (group.providerId !== canonical.providerId) {
        continue
      }
      const match = group.models.find(
        (model) => model.modelId === canonical.modelId,
      )
      if (match) {
        return formatModelRefLabel(match, group.providerName)
      }
    }
    return formatModelRefLabel(canonical)
  }

  const serializedValueForModel = (providerId: string, modelId: string): string =>
    serializeModelRef({ providerId, modelId })

  watch(
    [settingsFingerprint, () => options.extraModelRefs?.value],
    async () => {
      try {
        await refresh()
      } catch {
        groups.value = []
        loading.value = false
      }
    },
    { immediate: true, deep: true },
  )

  return {
    groups,
    loading,
    hasProviders,
    refresh,
    filterGroups,
    labelForSerialized,
    serializedValueForModel,
  }
}
