import { formatCatalogPricingParts, resolveDisplayPricing } from '@/services/models/options'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'

export type ModelCostLineKey = 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning'

export type ModelCostLine = {
  key: ModelCostLineKey
  label: string
  value: string
  tooltip: string
}

export type ModelCostView = {
  estimated: boolean
  lines: ModelCostLine[]
} | null

export type BuildModelCostInput = {
  meta?: ModelCatalogMeta
  option?: ModelCatalogOption
}

export const MODEL_COST_ESTIMATED_TOOLTIP = 'Fast pricing estimated from standard rates'

const perMillionTooltip = (label: string): string => `${label} per 1M tokens`

export const buildModelCost = ({ meta, option }: BuildModelCostInput): ModelCostView => {
  const resolved = resolveDisplayPricing({ meta, option })
  if (resolved.rates === null) {
    return null
  }

  const parts = formatCatalogPricingParts(resolved.rates)
  const lines: ModelCostLine[] = [
    {
      key: 'input',
      label: 'Input',
      value: parts.input,
      tooltip: perMillionTooltip('Input'),
    },
    {
      key: 'output',
      label: 'Output',
      value: parts.output,
      tooltip: perMillionTooltip('Output'),
    },
  ]

  if (parts.cacheRead !== undefined) {
    lines.push({
      key: 'cacheRead',
      label: 'Cache read',
      value: parts.cacheRead,
      tooltip: perMillionTooltip('Cache read'),
    })
  }

  if (parts.cacheWrite !== undefined) {
    lines.push({
      key: 'cacheWrite',
      label: 'Cache write',
      value: parts.cacheWrite,
      tooltip: perMillionTooltip('Cache write'),
    })
  }

  if (resolved.showReasoningRate && parts.reasoning !== undefined) {
    lines.push({
      key: 'reasoning',
      label: 'Reasoning',
      value: parts.reasoning,
      tooltip: perMillionTooltip('Reasoning'),
    })
  }

  return { estimated: resolved.fastEstimated, lines }
}
