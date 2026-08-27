import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type ModelCatalogOption = {
  reasoning?: ReasoningLevel
  fast?: boolean
  /** When false, hide from chat model pickers. Default true. */
  allowed?: boolean
  contextWindow?: number
  maxOutputTokens?: number
}

export type ModelCatalogOptionsMap = Record<string, ModelCatalogOption>
