import type { ModelMessage } from 'ai'
import type {
  GenerateCheckpointInput,
  GenerateCheckpointResult,
} from '@/types/harness/generate-checkpoint'
import boundRewrittenMessages from './bound-rewritten-messages'
import buildFallbackCheckpoint from './build-fallback-checkpoint'
import generateCheckpoint from './generate-checkpoint'
import { estimatePromptTokens } from './prompt-high-water'
import repairToolPairing from './repair-tool-pairing'
import rewriteModelMessages from './rewrite-model-messages'
import stillExceedsMessage from './still-exceeds-message'

type RunCompactRewriteInput = {
  checkpointInput: GenerateCheckpointInput
  system: string
  messages: ModelMessage[]
  highWater: number
  hardWindow?: number
}

type RunCompactRewriteResult = {
  messages: ModelMessage[]
  /** Summary written to activeContext / compaction events. */
  summary: string
  /** Paid checkpoint call, when one succeeded. May differ from summary. */
  compacted: GenerateCheckpointResult | null
}

const rewriteMessages = (
  messages: ModelMessage[],
  summary: string,
): ModelMessage[] =>
  repairToolPairing(rewriteModelMessages(messages, summary))

export default async (
  input: RunCompactRewriteInput,
): Promise<RunCompactRewriteResult> => {
  let compacted: GenerateCheckpointResult | null = null
  const estimated = estimatePromptTokens(input.system, input.messages)
  const skipGenerate =
    typeof input.hardWindow === 'number' && estimated > input.hardWindow

  let summary: string
  if (skipGenerate) {
    summary = buildFallbackCheckpoint(input.messages)
  } else {
    try {
      compacted = await generateCheckpoint(input.checkpointInput)
      summary = compacted.summary
    } catch (error) {
      if (input.checkpointInput.signal.aborted) {
        throw error
      }
      summary = buildFallbackCheckpoint(input.messages)
    }
  }

  let rewritten = rewriteMessages(input.messages, summary)
  let rewrittenEstimate = estimatePromptTokens(input.system, rewritten)

  if (rewrittenEstimate > input.highWater && compacted) {
    const fallbackSummary = buildFallbackCheckpoint(input.messages)
    const fallbackRewritten = rewriteMessages(input.messages, fallbackSummary)
    const fallbackEstimate = estimatePromptTokens(
      input.system,
      fallbackRewritten,
    )
    if (fallbackEstimate < rewrittenEstimate) {
      summary = fallbackSummary
      rewritten = fallbackRewritten
      rewrittenEstimate = fallbackEstimate
    }
  }

  if (rewrittenEstimate > input.highWater) {
    rewritten = boundRewrittenMessages(rewritten, input.system, input.highWater)
    rewrittenEstimate = estimatePromptTokens(input.system, rewritten)
  }

  if (rewrittenEstimate > input.highWater) {
    throw new Error(stillExceedsMessage(input.checkpointInput.focus))
  }

  return { messages: rewritten, summary, compacted }
}
