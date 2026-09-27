import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

export type ModelSearchCapabilityKey = 'vision' | 'tools' | 'reasoning' | 'fast'

export type ModelSearchCapabilityItem = {
  key: ModelSearchCapabilityKey
  tooltip: string
  muted: boolean
  label?: string
}

export type ModelSearchResultViewInput = {
  meta?: ModelCatalogMeta
  option?: ModelCatalogOption
  capability?: ReasoningCapability
  supportsFast?: boolean
}

export const buildModelSearchCapabilities = ({
  meta,
  option,
  capability,
  supportsFast,
}: ModelSearchResultViewInput): ModelSearchCapabilityItem[] => {
  const items: ModelSearchCapabilityItem[] = []

  if (meta?.vision === true) {
    items.push({
      key: 'vision',
      tooltip: 'Vision',
      muted: false,
    })
  }

  if (meta?.toolCalling === true) {
    items.push({
      key: 'tools',
      tooltip: 'Tools',
      muted: false,
    })
  }

  if (capability?.supported === true) {
    const level = option?.reasoning
    const hasChosenLevel = level !== undefined && level !== 'provider-default'
    items.push({
      key: 'reasoning',
      tooltip: hasChosenLevel ? `Reasoning: ${level}` : 'Reasoning',
      muted: !hasChosenLevel,
      ...(hasChosenLevel ? { label: level } : {}),
    })
  }

  if (supportsFast === true) {
    const fastOn = option?.fast === true
    items.push({
      key: 'fast',
      tooltip: fastOn ? 'Fast on' : 'Fast available',
      muted: !fastOn,
    })
  }

  return items
}
