import { httpProxyRequest } from '@/services/vixl/vixl-tauri'
import { getProviderCatalogEntry } from '@/services/providers/registry'
import {
  resolveModelsListRequest,
  type ProviderRequestContext,
} from '@/services/providers/provider-http'
import {
  mergeParsedModelRows,
  parseModelsFromResponse,
} from '@/services/providers/list-models'
import type { ParsedModelRow } from '@/types/models/parsed-model-row'

export type { ParsedModelRow }

const dedupeAndSortRows = (rows: ParsedModelRow[]): ParsedModelRow[] => {
  const byId = new Map<string, ParsedModelRow>()
  for (const row of rows) {
    if (!row.id) {
      continue
    }
    const existing = byId.get(row.id)
    byId.set(row.id, existing ? mergeParsedModelRows(existing, row) : row)
  }
  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
}

const catalogFallbackModels = (providerId: string): ParsedModelRow[] =>
  (getProviderCatalogEntry(providerId)?.models ?? []).map((id) => ({ id }))

export const listProviderModels = async (
  input: ProviderRequestContext,
): Promise<ParsedModelRow[]> => {
  const request = resolveModelsListRequest(input)
  const result = await httpProxyRequest({
    url: request.url,
    method: 'GET',
    headers: request.headers,
  })

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Model listing failed with status ${result.status}`)
  }

  const models = dedupeAndSortRows(
    parseModelsFromResponse(input.providerId, result.body),
  )

  if (models.length > 0) {
    return models
  }

  return catalogFallbackModels(input.catalogProviderId ?? input.providerId)
}
