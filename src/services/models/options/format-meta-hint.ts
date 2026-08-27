import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import formatTokenCount from './format-token-count'
import formatCatalogPricing from './format-pricing'

const formatCatalogMetaHint = (
  meta: ModelCatalogMeta,
  options?: { omitContext?: boolean; omitOutput?: boolean },
): string[] => {
  const lines: string[] = []

  if (
    !options?.omitContext &&
    typeof meta.contextWindow === 'number' &&
    meta.contextWindow > 0
  ) {
    lines.push(`Context ${formatTokenCount(meta.contextWindow)}`)
  }
  if (
    !options?.omitOutput &&
    typeof meta.maxOutputTokens === 'number' &&
    meta.maxOutputTokens > 0
  ) {
    lines.push(`Max output ${formatTokenCount(meta.maxOutputTokens)}`)
  }

  const caps: string[] = []
  if (meta.vision === true) {
    caps.push('Vision')
  }
  if (meta.toolCalling === true) {
    caps.push('Tools')
  }
  if (caps.length > 0) {
    lines.push(caps.join(', '))
  }

  const pricing = formatCatalogPricing(meta.pricing)
  if (pricing) {
    lines.push(pricing)
  }

  return lines
}

export default formatCatalogMetaHint
