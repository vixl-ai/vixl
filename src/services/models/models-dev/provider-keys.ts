import type { ModelsDevCatalog, ModelsDevModel } from '@/schemas/models/models-dev-catalog'
import { getProviderCatalogEntry } from '@/services/providers/registry'

const normalizeProviderId = (id: string): string =>
  id.trim().toLowerCase().replace(/[-_]/g, '')

const declaredPackage = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

const hostnameOf = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`)
    const host = url.hostname.toLowerCase()
    if (!host || /[${}%]/.test(host)) {
      return undefined
    }
    return host
  } catch {
    return undefined
  }
}

const packagesConflict = (
  localPkg: string | undefined,
  remotePkg: string | undefined,
): boolean =>
  localPkg !== undefined && remotePkg !== undefined && localPkg !== remotePkg

/**
 * Resolve a Vixl provider id to a models.dev api.json top-level key.
 * Order: matching npm/packageName, exact or normalized id (rejected when
 * both sides declare different packages), then API host.
 */
export const resolveModelsDevProviderKey = (
  catalog: ModelsDevCatalog,
  providerId: string,
): string | undefined => {
  const trimmed = providerId.trim()
  if (!trimmed) {
    return undefined
  }

  const localPkg = declaredPackage(getProviderCatalogEntry(trimmed)?.packageName)

  if (localPkg) {
    for (const [key, provider] of Object.entries(catalog)) {
      if (declaredPackage(provider?.npm) === localPkg) {
        return key
      }
    }
  }

  const acceptIdKey = (key: string): string | undefined => {
    const provider = catalog[key]
    if (!provider) {
      return undefined
    }
    if (packagesConflict(localPkg, declaredPackage(provider.npm))) {
      return undefined
    }
    return key
  }

  const exact = acceptIdKey(trimmed) ?? acceptIdKey(trimmed.toLowerCase())
  if (exact) {
    return exact
  }

  const normalized = normalizeProviderId(trimmed)
  if (normalized) {
    for (const key of Object.keys(catalog)) {
      if (normalizeProviderId(key) !== normalized) {
        continue
      }
      const accepted = acceptIdKey(key)
      if (accepted) {
        return accepted
      }
    }
  }

  const localHost = hostnameOf(getProviderCatalogEntry(trimmed)?.defaultBaseUrl)
  if (!localHost) {
    return undefined
  }
  for (const [key, provider] of Object.entries(catalog)) {
    if (hostnameOf(provider?.api) === localHost) {
      return key
    }
  }
  return undefined
}

export const lookupModelsDevModel = (
  catalog: ModelsDevCatalog,
  providerId: string,
  modelId: string,
): ModelsDevModel | undefined => {
  const providerKey = resolveModelsDevProviderKey(catalog, providerId)
  const id = modelId.trim()
  if (!providerKey || !id) {
    return undefined
  }
  return catalog[providerKey]?.models?.[id]
}
