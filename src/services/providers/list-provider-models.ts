import { httpProxyRequest } from '@/services/vixl/vixl-tauri'
import { getProviderCatalogEntry } from '@/services/providers/registry'
import {
  resolveModelsListRequest,
  type ProviderRequestContext,
} from '@/services/providers/provider-http'
import {
  isReasoningLevel,
  type ReasoningLevel,
} from '@/types/models/reasoning-level'

export type ParsedModelRow = {
  id: string
  supportsReasoningEffort?: ReasoningLevel[]
  reasoningMandatory?: boolean
  supportsFast?: boolean
}

type OpenRouterModelRow = {
  id?: string
  reasoning?: {
    supported_efforts?: unknown[]
    mandatory?: unknown
  }
}

type GatewayModelRow = {
  id?: string
  tags?: unknown[]
}

type GoogleModelRow = {
  name?: string
  id?: string
  supported_generation_methods?: unknown[]
}

type GenericModelRow = {
  id?: string
  name?: string
}

const FAST_ID_SUFFIXES = ['-fast', '-highspeed'] as const

const endsWithFastSuffix = (modelId: string): boolean => {
  const lower = modelId.toLowerCase()
  return FAST_ID_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

const unionReasoningLevels = (
  left?: ReasoningLevel[],
  right?: ReasoningLevel[],
): ReasoningLevel[] | undefined => {
  if (!left?.length && !right?.length) {
    return undefined
  }
  if (!left?.length) {
    return right
  }
  if (!right?.length) {
    return left
  }
  const seen = new Set<ReasoningLevel>()
  const next: ReasoningLevel[] = []
  for (const level of [...left, ...right]) {
    if (seen.has(level)) {
      continue
    }
    seen.add(level)
    next.push(level)
  }
  return next
}

const mergeParsedModelRows = (
  left: ParsedModelRow,
  right: ParsedModelRow,
): ParsedModelRow => {
  const supportsReasoningEffort = unionReasoningLevels(
    left.supportsReasoningEffort,
    right.supportsReasoningEffort,
  )
  const reasoningMandatory =
    left.reasoningMandatory === true || right.reasoningMandatory === true
      ? true
      : undefined
  const supportsFast =
    left.supportsFast === true || right.supportsFast === true ? true : undefined

  return {
    id: left.id,
    ...(supportsReasoningEffort ? { supportsReasoningEffort } : {}),
    ...(reasoningMandatory ? { reasoningMandatory } : {}),
    ...(supportsFast ? { supportsFast } : {}),
  }
}

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

const parseOpenRouterRows = (data: OpenRouterModelRow[]): ParsedModelRow[] => {
  const rows: ParsedModelRow[] = []
  for (const model of data) {
    const id = model.id ?? ''
    if (!id) {
      continue
    }
    const supportedEfforts = model.reasoning?.supported_efforts
    const levels =
      Array.isArray(supportedEfforts)
        ? supportedEfforts.filter(isReasoningLevel)
        : undefined
    const mandatory = model.reasoning?.mandatory
    const row: ParsedModelRow = { id }
    if (levels && levels.length > 0) {
      row.supportsReasoningEffort = levels
    }
    if (typeof mandatory === 'boolean') {
      row.reasoningMandatory = mandatory
    }
    if (endsWithFastSuffix(id)) {
      row.supportsFast = true
    }
    rows.push(row)
  }
  return rows
}

const parseGatewayRows = (data: GatewayModelRow[]): ParsedModelRow[] => {
  const rows: ParsedModelRow[] = []
  for (const model of data) {
    const id = model.id ?? ''
    if (!id) {
      continue
    }
    const tags = Array.isArray(model.tags)
      ? model.tags.filter((tag): tag is string => typeof tag === 'string')
      : []
    const row: ParsedModelRow = { id }
    // Gateway may tag models with "reasoning" without effort subsets. Leave
    // supportsReasoningEffort undefined so the family resolver supplies levels.
    if (tags.includes('fast') || endsWithFastSuffix(id)) {
      row.supportsFast = true
    }
    rows.push(row)
  }
  return rows
}

const isKnownGoogleThinkingFamily = (modelId: string): boolean => {
  const lower = modelId.toLowerCase()
  return (
    lower.includes('thinking') ||
    lower.startsWith('gemini-2.5') ||
    lower.startsWith('gemini-3') ||
    lower.startsWith('gemini-2.0-flash-thinking')
  )
}

const parseGoogleRows = (models: GoogleModelRow[]): ParsedModelRow[] => {
  const ids = models
    .map((model) => (model.name ?? model.id ?? '').replace(/^models\//, ''))
    .filter((id) => id.length > 0)
  const idSet = new Set(ids.map((id) => id.toLowerCase()))

  const rows: ParsedModelRow[] = []
  for (const model of models) {
    const id = (model.name ?? model.id ?? '').replace(/^models\//, '')
    if (!id) {
      continue
    }
    const methods = Array.isArray(model.supported_generation_methods)
      ? model.supported_generation_methods.filter(
          (method): method is string => typeof method === 'string',
        )
      : []
    const thinkingCapable =
      methods.includes('thinking') || isKnownGoogleThinkingFamily(id)

    const row: ParsedModelRow = { id }
    // Leave supportsReasoningEffort undefined; family resolver handles Google.
    if (thinkingCapable) {
      const hasFastSibling =
        idSet.has(`${id.toLowerCase()}-fast`) ||
        idSet.has(`${id.toLowerCase()}-highspeed`)
      if (hasFastSibling || endsWithFastSuffix(id)) {
        row.supportsFast = true
      }
    } else if (endsWithFastSuffix(id)) {
      row.supportsFast = true
    }
    rows.push(row)
  }
  return rows
}

const parseIdOnlyRows = (data: GenericModelRow[]): ParsedModelRow[] =>
  data
    .map((model) => {
      const id = model.id ?? model.name ?? ''
      return id ? { id } : null
    })
    .filter((row): row is ParsedModelRow => row !== null)

const parseModelsFromResponse = (
  providerId: string,
  body: string,
): ParsedModelRow[] => {
  const parsed = JSON.parse(body) as {
    data?: unknown[]
    models?: unknown[]
  }

  if (providerId === 'google') {
    const models = Array.isArray(parsed.models)
      ? (parsed.models as GoogleModelRow[])
      : []
    return parseGoogleRows(models)
  }

  if (providerId === 'openrouter' && Array.isArray(parsed.data)) {
    return parseOpenRouterRows(parsed.data as OpenRouterModelRow[])
  }

  if (providerId === 'gateway' && Array.isArray(parsed.data)) {
    return parseGatewayRows(parsed.data as GatewayModelRow[])
  }

  if (Array.isArray(parsed.data)) {
    return parseIdOnlyRows(parsed.data as GenericModelRow[])
  }

  if (Array.isArray(parsed.models)) {
    return parseIdOnlyRows(parsed.models as GenericModelRow[])
  }

  return []
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
