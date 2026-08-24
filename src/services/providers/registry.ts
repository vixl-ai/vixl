import aiSdkProviderCatalog from '@/data/ai-sdk-provider-catalog'
import type { ProviderCatalogEntry } from '@/types/providers/provider-catalog-entry'
import type { VixlCustomProvider, VixlSettings } from '@/types/vixl/vixl-settings'

export type { ProviderCatalogEntry } from '@/types/providers/provider-catalog-entry'

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = aiSdkProviderCatalog

export const AI_SDK_PROVIDER_CATALOG = PROVIDER_CATALOG.filter(
  (entry) => entry.category === 'ai-sdk',
)

export const OPENAI_COMPATIBLE_PROVIDER_CATALOG = PROVIDER_CATALOG.filter(
  (entry) => entry.category === 'openai-compatible',
)

export const getProviderCatalogEntry = (id: string): ProviderCatalogEntry | undefined =>
  PROVIDER_CATALOG.find((entry) => entry.id === id)

export const providerKeyRef = (providerId: string): string => providerId

export const keychainKeyForProvider = (apiKeyRef: string): string =>
  `vixl:provider:${apiKeyRef}`

export const getCustomProvider = (
  settings: VixlSettings,
  providerId: string,
): VixlCustomProvider | undefined => {
  const customKey = `providers.custom.${providerId}` as const
  return settings[customKey]
}

export const providerRequiresApiKey = (
  providerId: string,
  settings?: VixlSettings,
): boolean => {
  if (settings && getCustomProvider(settings, providerId)) {
    return false
  }
  const entry = getProviderCatalogEntry(providerId)
  if (!entry) {
    return true
  }
  return entry.requiresApiKey !== false
}
