import type { ModelCatalogOption } from '@/types/models/model-catalog-option'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import resolveReasoningCapability from '@/services/models/resolve-reasoning-capability'
import resolveSupportsFast from '@/services/models/resolve-fast-capability'
import { getModelCatalogMeta } from '@/services/models/model-catalog-meta'

const clampToReported = (
  override: number | undefined,
  reported: number | undefined,
): number | undefined => {
  if (typeof override !== 'number' || !Number.isFinite(override)) {
    return undefined
  }
  if (typeof reported === 'number' && reported > 0) {
    return Math.min(Math.max(1, override), reported)
  }
  return override
}

/**
 * Return a catalog option clamped to what the model actually supports.
 * Does not mutate the input. Used for UI reads and call-time mapping;
 * do not use on save paths that should preserve raw user intent.
 */
export const clampModelCatalogOption = (
  settings: VixlSettings,
  ref: ModelRef,
  option: ModelCatalogOption,
): ModelCatalogOption => {
  const next: ModelCatalogOption = { ...option }

  const capability = resolveReasoningCapability(settings, ref)
  if (!capability.supported) {
    delete next.reasoning
  } else if (next.reasoning !== undefined && next.reasoning !== 'provider-default') {
    if (!capability.levels.includes(next.reasoning)) {
      delete next.reasoning
    } else if (capability.mandatory && next.reasoning === 'none') {
      delete next.reasoning
    }
  }

  if (next.fast === true && !resolveSupportsFast(ref)) {
    delete next.fast
  }

  const meta = getModelCatalogMeta(settings, ref)
  const contextWindow = clampToReported(next.contextWindow, meta.contextWindow)
  if (contextWindow === undefined) {
    delete next.contextWindow
  } else {
    next.contextWindow = contextWindow
  }
  const maxOutputTokens = clampToReported(next.maxOutputTokens, meta.maxOutputTokens)
  if (maxOutputTokens === undefined) {
    delete next.maxOutputTokens
  } else {
    next.maxOutputTokens = maxOutputTokens
  }

  return next
}

export default clampModelCatalogOption
