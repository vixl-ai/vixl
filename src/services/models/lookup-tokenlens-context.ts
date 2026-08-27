import { getContext } from 'tokenlens'

export default (modelId: string): number | undefined => {
  if (!modelId) {
    return undefined
  }
  try {
    const context = getContext({ modelId })
    const value = context.maxInput ?? context.maxTotal
    if (typeof value !== 'number' || value <= 0) {
      return undefined
    }
    return value
  } catch {
    return undefined
  }
}
