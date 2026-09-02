import { computed, ref, watch, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import useVixlConfig from '@/composables/use-vixl-config'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import listAllProviderModels from '@/services/providers/list-all-provider-models'
import collapseProviderModelGroups from '@/services/models/collapse-provider-model-groups'
import mergeCatalogMetaFromGroups from '@/services/models/merge-catalog-meta-from-groups'
import mergeExtraModels from '@/services/models/merge-extra-models'
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

export default (options: UseProviderModelsCatalogOptions) => {
  const config = useVixlConfig()
  const groups = ref<ProviderModelGroup[]>([])
  const listedGroups = ref<ProviderModelGroup[]>([])
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

  const applyGroups = (): void => {
    const extra = options.extraModelRefs?.value ?? []
    groups.value = collapseProviderModelGroups(
      mergeExtraModels(listedGroups.value, extra),
    )
  }

  const refresh = async (): Promise<void> => {
    const generation = ++loadGeneration
    loading.value = true

    try {
      const loaded = await listAllProviderModels(options.settings.value)
      if (generation !== loadGeneration) {
        return
      }
      listedGroups.value = loaded
      applyGroups()
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
    settingsFingerprint,
    async () => {
      try {
        await refresh()
      } catch {
        groups.value = []
        loading.value = false
      }
    },
    { immediate: true },
  )

  watch(
    () => options.extraModelRefs?.value,
    () => {
      applyGroups()
    },
    { deep: true },
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
