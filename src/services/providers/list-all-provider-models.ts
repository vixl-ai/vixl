import type { VixlCustomProvider, VixlSettings } from '@/types/vixl/vixl-settings'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { ModelRef } from '@/types/models/model-ref'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import {
  getCustomProvider,
  getProviderCatalogEntry,
  keychainKeyForProvider,
  providerRequiresApiKey,
} from '@/services/providers/registry'
import { getSecret } from '@/services/vixl/vixl-tauri'
import {
  listProviderModels,
  type ParsedModelRow,
} from '@/services/providers/list-provider-models'
import { mergeParsedModelRows } from '@/services/providers/list-models'

const getApiKeyRef = (
  settings: VixlSettings,
  providerId: string,
): string | undefined => {
  const custom = getCustomProvider(settings, providerId)
  if (custom?.apiKeyRef) {
    return custom.apiKeyRef
  }
  const key = `providers.${providerId}.apiKeyRef` as const
  return settings[key]
}

const getProviderDisplayName = (
  settings: VixlSettings,
  providerId: string,
): string => {
  const custom = getCustomProvider(settings, providerId)
  if (custom?.name) {
    return custom.name
  }
  return getProviderCatalogEntry(providerId)?.name ?? providerId
}

const configuredModelIds = (custom: VixlCustomProvider | undefined): string[] =>
  custom?.models?.map((model) => model.id).filter(Boolean) ?? []

const catalogRows = (providerId: string): ParsedModelRow[] =>
  (getProviderCatalogEntry(providerId)?.models ?? []).map((id) => ({ id }))

const mergeModelRows = (
  configured: string[],
  live: ParsedModelRow[],
): ParsedModelRow[] => {
  const byId = new Map<string, ParsedModelRow>()

  for (const id of configured) {
    if (!id || byId.has(id)) {
      continue
    }
    byId.set(id, { id })
  }

  for (const row of live) {
    if (!row.id) {
      continue
    }
    const existing = byId.get(row.id)
    byId.set(row.id, existing ? mergeParsedModelRows(existing, row) : row)
  }

  const merged: ParsedModelRow[] = []
  const seen = new Set<string>()
  for (const id of configured) {
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const row = byId.get(id)
    if (row) {
      merged.push(row)
    }
  }
  for (const row of live) {
    if (!row.id || seen.has(row.id)) {
      continue
    }
    seen.add(row.id)
    const resolved = byId.get(row.id)
    if (resolved) {
      merged.push(resolved)
    }
  }
  return merged
}

const toModelRefs = (
  providerId: string,
  rows: ParsedModelRow[],
  custom: VixlCustomProvider | undefined,
): ModelRef[] =>
  rows.map((row) => {
    const configured = custom?.models?.find((model) => model.id === row.id)
    return {
      providerId,
      modelId: row.id,
      ...(configured?.name ? { name: configured.name } : {}),
      ...(row.supportsReasoningEffort
        ? { supportsReasoningEffort: row.supportsReasoningEffort }
        : {}),
      ...(row.reasoningMandatory !== undefined
        ? { reasoningMandatory: row.reasoningMandatory }
        : {}),
      ...(row.supportsFast ? { supportsFast: true } : {}),
      ...(row.contextWindow !== undefined ? { contextWindow: row.contextWindow } : {}),
      ...(row.maxOutputTokens !== undefined
        ? { maxOutputTokens: row.maxOutputTokens }
        : {}),
      ...(row.pricing ? { pricing: row.pricing } : {}),
      ...(row.vision ? { vision: true } : {}),
      ...(row.toolCalling ? { toolCalling: true } : {}),
    }
  })

const loadProviderModelGroup = async (
  settings: VixlSettings,
  providerId: string,
): Promise<ProviderModelGroup> => {
  const custom = getCustomProvider(settings, providerId)
  const catalogEntry = getProviderCatalogEntry(providerId)
  const requiresKey = providerRequiresApiKey(providerId, settings)
  const providerName = getProviderDisplayName(settings, providerId)
  const configured = configuredModelIds(custom)

  let apiKey = ''
  const apiKeyRef = getApiKeyRef(settings, providerId)
  if (apiKeyRef) {
    apiKey = (await getSecret(keychainKeyForProvider(apiKeyRef))) ?? ''
  }

  let liveRows: ParsedModelRow[] = []

  try {
    if (requiresKey && !apiKey) {
      liveRows = catalogRows(providerId)
    } else {
      liveRows = await listProviderModels({
        providerId: custom ? 'openai' : providerId,
        catalogProviderId: providerId,
        apiKey,
        baseUrl: custom?.baseURL ?? catalogEntry?.defaultBaseUrl,
      })
    }
  } catch {
    liveRows = catalogRows(providerId)
  }

  const rows =
    configured.length > 0
      ? mergeModelRows(configured, liveRows)
      : liveRows.length > 0
        ? liveRows
        : catalogRows(providerId)

  return {
    providerId,
    providerName,
    models: toModelRefs(providerId, rows, custom),
  }
}

export default async (settings: VixlSettings): Promise<ProviderModelGroup[]> => {
  const providerIds = listConfiguredProviders(settings)

  if (providerIds.length === 0) {
    return []
  }

  const results = await Promise.allSettled(
    providerIds.map((providerId) => loadProviderModelGroup(settings, providerId)),
  )

  return results
    .filter((result): result is PromiseFulfilledResult<ProviderModelGroup> => result.status === 'fulfilled')
    .map((result) => result.value)
    .sort((left, right) => left.providerName.localeCompare(right.providerName))
}
