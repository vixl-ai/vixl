import type { ModelRef } from '@/types/models/model-ref'

/** Suffixes that are speed/serving variants of a base model, not separate products. */
const FAST_SUFFIXES = ['-fast', '-highspeed'] as const

export type ModelVariantKind = 'base' | 'fast'

export type ParsedModelVariant = {
  modelId: string
  baseModelId: string
  kind: ModelVariantKind
  /** Short id used for picker group headings (last path segment of base). */
  displayKey: string
}

const shortId = (modelId: string): string => {
  const slashIndex = modelId.lastIndexOf('/')
  if (slashIndex >= 0 && slashIndex < modelId.length - 1) {
    return modelId.slice(slashIndex + 1)
  }
  return modelId
}

export const parseModelVariant = (modelId: string): ParsedModelVariant => {
  const trimmed = modelId.trim()
  for (const suffix of FAST_SUFFIXES) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      const baseModelId = trimmed.slice(0, -suffix.length)
      if (baseModelId.length > 0) {
        return {
          modelId: trimmed,
          baseModelId,
          kind: 'fast',
          displayKey: shortId(baseModelId),
        }
      }
    }
  }

  return {
    modelId: trimmed,
    baseModelId: trimmed,
    kind: 'base',
    displayKey: shortId(trimmed),
  }
}

export const isFastModelId = (modelId: string): boolean =>
  parseModelVariant(modelId).kind === 'fast'

export const toBaseModelId = (modelId: string): string =>
  parseModelVariant(modelId).baseModelId

export const preferredFastSiblingId = (
  baseModelId: string,
  candidates: Iterable<string>,
): string | undefined => {
  const wanted = new Set(
    FAST_SUFFIXES.map((suffix) => `${baseModelId}${suffix}`.toLowerCase()),
  )
  let match: string | undefined
  for (const candidate of candidates) {
    if (wanted.has(candidate.toLowerCase())) {
      if (!match || candidate.length < match.length) {
        match = candidate
      }
    }
  }
  return match
}

export const collapseModelVariants = (models: ModelRef[]): ModelRef[] => {
  const byId = new Map(models.map((model) => [model.modelId, model]))
  const ids = [...byId.keys()]
  const collapsed: ModelRef[] = []
  const consumed = new Set<string>()

  for (const model of models) {
    const parsed = parseModelVariant(model.modelId)
    if (parsed.kind === 'fast') {
      const base = byId.get(parsed.baseModelId)
      if (base) {
        consumed.add(model.modelId)
        continue
      }
    }

    if (consumed.has(model.modelId)) {
      continue
    }

    const fastModelId = preferredFastSiblingId(parsed.baseModelId, ids)
    const chosenFastId = fastModelId ?? model.fastModelId
    const fastSibling =
      chosenFastId && chosenFastId !== model.modelId
        ? byId.get(chosenFastId)
        : undefined
    const fastPricing = fastSibling?.pricing
    collapsed.push({
      ...model,
      modelId: parsed.baseModelId,
      name: model.name ?? parsed.displayKey,
      supportsFast: Boolean(fastModelId) || model.supportsFast === true,
      fastModelId: fastModelId ?? model.fastModelId,
      ...(fastPricing ? { fastPricing } : {}),
    })
    consumed.add(model.modelId)
    if (fastModelId) {
      consumed.add(fastModelId)
    }
  }

  return collapsed.sort((left, right) =>
    left.modelId.localeCompare(right.modelId),
  )
}

export default parseModelVariant
