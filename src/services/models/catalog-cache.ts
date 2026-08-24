import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import collapseProviderModelGroups from '@/services/models/collapse-provider-model-groups'
import listAllProviderModels from '@/services/providers/list-all-provider-models'

type CacheEntry = {
  fingerprint: string
  groups: ProviderModelGroup[]
}

let cache: CacheEntry | null = null

/** Same fingerprint idea as use-provider-models-catalog (apiKeyRef + custom providers). */
const settingsFingerprint = (settings: VixlSettings): string => {
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
}

/**
 * Load provider model groups with an in-memory cache keyed by settings fingerprint.
 * On miss, calls listAllProviderModels once then collapses variants.
 */
const loadProviderModelsCatalog = async (
  settings: VixlSettings,
): Promise<ProviderModelGroup[]> => {
  const fingerprint = settingsFingerprint(settings)
  if (cache && cache.fingerprint === fingerprint) {
    return cache.groups
  }
  const loaded = await listAllProviderModels(settings)
  const groups = collapseProviderModelGroups(loaded)
  cache = { fingerprint, groups }
  return groups
}

export default loadProviderModelsCatalog
