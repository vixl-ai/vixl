import type { ModelMessage } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  resolveContextWindow,
  resolveModelCallOptions,
} from '@/services/models/resolve-model-call-options'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const HIGH_WATER_RATIO = 0.7

export const estimatePromptTokens = (
  system: string,
  messages: ModelMessage[],
): number =>
  estimateTextTokens(system) +
  messages.reduce(
    (sum, message) => sum + estimateTextTokens(JSON.stringify(message)),
    0,
  )

export const resolveCompactWindow = (
  settings: VixlSettings,
  modelRef: ModelRef,
): number => resolveContextWindow(settings, modelRef)

export const resolveCompactHighWater = (
  settings: VixlSettings,
  modelRef: ModelRef,
): number => {
  const windowTokens = resolveCompactWindow(settings, modelRef)
  const reserved =
    resolveModelCallOptions(settings, modelRef, {
      maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    }).maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS
  return Math.floor((windowTokens - reserved) * HIGH_WATER_RATIO)
}
