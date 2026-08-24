import type { CatalogMatch } from '@/types/models/catalog-match'
import type { ModelRef } from '@/types/models/model-ref'
import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type {
  ResolveCatalogMatchesOptions,
  ResolveCatalogMatchesResult,
} from '@/types/models/resolve-catalog-matches-result'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { isModelAllowed } from '@/services/models/model-catalog-options'
import { resolveModelForRole } from '@/services/models/resolve-model-for-role'
import humanizeModelId from '@/utils/humanize-model-id'
import { modelShortId } from '@/utils/model-vendor'
import parseModelRef from '@/utils/parse-model-ref'
import serializeModelRef from '@/utils/serialize-model-ref'
import filterByProvider from './filter-by-provider'
import filterScoredProviderModels from './filter-scored-provider-models'

/** Matches SCORE_EXACT in score-model-match.ts (exact id/name). */
const SCORE_EXACT = 100
const MATCH_CAP = 8

const modelDisplayName = (model: ModelRef): string => {
  const named = model.name?.trim()
  if (named) {
    return named
  }
  return humanizeModelId(modelShortId(model.modelId))
}

const filterAllowedGroups = (
  groups: ProviderModelGroup[],
  settings: VixlSettings,
): ProviderModelGroup[] => {
  const next: ProviderModelGroup[] = []
  for (const group of groups) {
    const models = group.models.filter((model) =>
      isModelAllowed(settings, {
        providerId: model.providerId,
        modelId: model.modelId,
      }),
    )
    if (models.length > 0) {
      next.push({ ...group, models })
    }
  }
  return next
}

const countModels = (groups: ProviderModelGroup[]): number =>
  groups.reduce((total, group) => total + group.models.length, 0)

const toCatalogMatch = (
  group: ProviderModelGroup,
  model: ModelRef,
  score: number,
): CatalogMatch => ({
  ref: serializeModelRef({
    providerId: model.providerId,
    modelId: model.modelId,
  }),
  name: modelDisplayName(model),
  providerId: group.providerId,
  providerName: group.providerName,
  score,
})

const pickBest = (matches: CatalogMatch[]): string | undefined => {
  if (matches.length === 0) {
    return undefined
  }
  const top = matches[0]
  if (!top) {
    return undefined
  }
  if (matches.length === 1) {
    return top.ref
  }
  if (top.score < SCORE_EXACT) {
    return undefined
  }
  const exactCount = matches.filter((match) => match.score >= SCORE_EXACT).length
  if (exactCount === 1) {
    return top.ref
  }
  return undefined
}

const resolveSuggestedForProvider = (
  settings: VixlSettings,
  providerId: string,
): string | undefined => {
  const serialized = resolveModelForRole('subagent', settings)
  if (!serialized) {
    return undefined
  }
  const parsed = parseModelRef(serialized)
  if (!parsed || parsed.providerId !== providerId) {
    return undefined
  }
  if (!isModelAllowed(settings, parsed)) {
    return undefined
  }
  return serializeModelRef(parsed)
}

const resolveCatalogMatches = (
  groups: ProviderModelGroup[],
  settings: VixlSettings,
  options: ResolveCatalogMatchesOptions,
): ResolveCatalogMatchesResult => {
  const query = options.query?.trim() ?? ''
  const provider = options.provider?.trim() ?? ''

  if (!query && !provider) {
    return {
      matches: [],
      error: 'Provide a query or provider',
    }
  }

  let scoped = groups
  if (provider) {
    scoped = filterByProvider(groups, provider)
    if (scoped.length === 0) {
      return {
        matches: [],
        error: 'No models found for that provider',
      }
    }
  }

  const allowed = filterAllowedGroups(scoped, settings)
  if (allowed.length === 0) {
    if (provider && !query) {
      return {
        matches: [],
        error: 'No models found for that provider',
      }
    }
    return { matches: [] }
  }

  if (provider && !query) {
    const count = countModels(allowed)
    const firstGroup = allowed[0]
    if (!firstGroup) {
      return { matches: [] }
    }
    const providerId = firstGroup.providerId
    if (count > MATCH_CAP) {
      const suggested = resolveSuggestedForProvider(settings, providerId)
      return {
        status: 'needs_query',
        providerId,
        count,
        ...(suggested ? { suggested } : {}),
      }
    }
    const matches = allowed.flatMap((group) =>
      group.models.map((model) => toCatalogMatch(group, model, 0)),
    )
    const best = pickBest(matches)
    return best ? { matches, best } : { matches }
  }

  const scored = filterScoredProviderModels(allowed, query)
  if (scored.length === 0) {
    if (provider) {
      return {
        matches: [],
        error: 'No models found for that provider',
      }
    }
    return { matches: [] }
  }

  const matches = scored
    .slice(0, MATCH_CAP)
    .map((entry) => toCatalogMatch(entry.group, entry.model, entry.score))
  const best = pickBest(matches)
  return best ? { matches, best } : { matches }
}

export default resolveCatalogMatches
