import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import formatTokenCount from './format-token-count'
import formatCatalogPricing from './format-pricing'

const formatCatalogMetaHint = (meta: ModelCatalogMeta): string[] => {
  const lines: string[] = []

  if (typeof meta.contextWindow === 'number' && meta.contextWindow > 0) {
    lines.push(`Reported context: ${formatTokenCount(meta.contextWindow)}`)
  }
  if (typeof meta.maxOutputTokens === 'number' && meta.maxOutputTokens > 0) {
    lines.push(`Reported max output: ${formatTokenCount(meta.maxOutputTokens)}`)
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
