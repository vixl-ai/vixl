import type { ParsedModelRow } from '@/types/models/parsed-model-row'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

const unionReasoningLevels = (
  left?: ReasoningLevel[],
  right?: ReasoningLevel[],
): ReasoningLevel[] | undefined => {
  if (!left?.length && !right?.length) {
    return undefined
  }
  if (!left?.length) {
    return right
  }
  if (!right?.length) {
    return left
  }
  const seen = new Set<ReasoningLevel>()
  const next: ReasoningLevel[] = []
  for (const level of [...left, ...right]) {
    if (seen.has(level)) {
      continue
    }
    seen.add(level)
    next.push(level)
  }
  return next
}

const orTrue = (left?: boolean, right?: boolean): true | undefined =>
  left === true || right === true ? true : undefined

export default (left: ParsedModelRow, right: ParsedModelRow): ParsedModelRow => {
  const supportsReasoningEffort = unionReasoningLevels(
    left.supportsReasoningEffort,
    right.supportsReasoningEffort,
  )
  const reasoningMandatory = orTrue(left.reasoningMandatory, right.reasoningMandatory)
  const supportsFast = orTrue(left.supportsFast, right.supportsFast)
  const vision = orTrue(left.vision, right.vision)
  const toolCalling = orTrue(left.toolCalling, right.toolCalling)
  const contextWindow = right.contextWindow ?? left.contextWindow
  const maxOutputTokens = right.maxOutputTokens ?? left.maxOutputTokens
  const pricing = right.pricing ?? left.pricing

  return {
    id: left.id,
    ...(supportsReasoningEffort ? { supportsReasoningEffort } : {}),
    ...(reasoningMandatory ? { reasoningMandatory } : {}),
    ...(supportsFast ? { supportsFast } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
    ...(pricing ? { pricing } : {}),
    ...(vision ? { vision } : {}),
    ...(toolCalling ? { toolCalling } : {}),
  }
}
