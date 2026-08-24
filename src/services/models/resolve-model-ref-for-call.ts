import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { getModelCatalogOption } from '@/services/models/model-catalog-options'
import resolveSupportsFast from '@/services/models/resolve-fast-capability'
import {
  isFastModelId,
  toBaseModelId,
} from '@/services/models/parse-model-variant'

export type ResolvedCallModelRef = {
  /** Ref passed to createModel (may be a -fast slug for non-gateway providers). */
  createRef: ModelRef
  /** Base ref used for catalog option lookup and settings keys. */
  optionRef: ModelRef
  fast: boolean
}

/**
 * Canonical base id for storage/UI. Fast serving is a catalog option, not a
 * separate selected model when a -fast sibling exists.
 */
export const canonicalizeModelRef = (ref: ModelRef): ModelRef => {
  if (!isFastModelId(ref.modelId)) {
    return {
      ...ref,
      modelId: ref.modelId,
    }
  }
  return {
    ...ref,
    modelId: toBaseModelId(ref.modelId),
    supportsFast: true,
    fastModelId: ref.fastModelId ?? ref.modelId,
  }
}

export const resolveModelRefForCall = (
  settings: VixlSettings,
  ref: ModelRef,
  fastOverride?: boolean,
): ResolvedCallModelRef => {
  const optionRef = canonicalizeModelRef(ref)
  const catalogFast = getModelCatalogOption(settings, optionRef).fast === true
  const selectedWasFast = isFastModelId(ref.modelId)
  const wantsFast =
    fastOverride === true || catalogFast || selectedWasFast
  const fast = wantsFast && resolveSupportsFast(optionRef)

  if (!fast) {
    return { createRef: optionRef, optionRef, fast: false }
  }

  // Gateway and Anthropic use providerOptions.speed on the base slug.
  if (optionRef.providerId === 'gateway' || optionRef.providerId === 'anthropic') {
    return { createRef: optionRef, optionRef, fast: true }
  }

  const fastModelId =
    optionRef.fastModelId ??
    (selectedWasFast ? ref.modelId : `${optionRef.modelId}-fast`)

  return {
    createRef: {
      ...optionRef,
      modelId: fastModelId,
    },
    optionRef,
    fast: true,
  }
}

export default resolveModelRefForCall
