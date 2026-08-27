import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import formatTokenCount from './format-token-count'

type FormatModelSearchSuffixInput = {
  option: ModelCatalogOption
  reportedContextWindow?: number
  fastFromModelId: boolean
}

const formatModelSearchSuffix = ({
  option,
  reportedContextWindow,
  fastFromModelId,
}: FormatModelSearchSuffixInput): string => {
  const bits: string[] = []
  const window =
    typeof option.contextWindow === 'number' && option.contextWindow > 0
      ? option.contextWindow
      : reportedContextWindow
  if (typeof window === 'number' && window > 0) {
    const label = formatTokenCount(window)
    if (label) {
      bits.push(label)
    }
  }
  if (option.reasoning && option.reasoning !== 'provider-default') {
    bits.push(option.reasoning)
  }
  if (option.fast === true || fastFromModelId) {
    bits.push('fast')
  }
  return bits.join(', ')
}

export default formatModelSearchSuffix
