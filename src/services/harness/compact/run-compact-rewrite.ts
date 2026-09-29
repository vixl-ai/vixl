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
  transformSummary?: (summary: string) => string
}

type RunCompactRewriteResult = {
  messages: ModelMessage[]
  /** Summary written to activeContext / compaction events. */
  summary: string
  /** Paid checkpoint call, when one succeeded. May differ from summary. */
  compacted: GenerateCheckpointResult | null
}

const CHECKPOINT_RETRY_NOTE =
  'Previous output was not a checkpoint. Do not answer the last user message or continue the conversation. Output only the checkpoint sections: Goal, Decisions, Files+symbols, Errors+fixes, Skills loaded, Plan+todos, Next.'

const rewriteMessages = (
  messages: ModelMessage[],
  summary: string,
): ModelMessage[] =>
  repairToolPairing(rewriteModelMessages(messages, summary))

const withRetryNote = (
  checkpointInput: GenerateCheckpointInput,
): GenerateCheckpointInput => ({
  ...checkpointInput,
  messages: [
    ...checkpointInput.messages,
    {
      role: 'user',
      content: CHECKPOINT_RETRY_NOTE,
    },
  ],
})

export default async (
  input: RunCompactRewriteInput,
): Promise<RunCompactRewriteResult> => {
  let compacted: GenerateCheckpointResult | null = null
  const estimated = estimatePromptTokens(input.system, input.messages)
  const skipGenerate =
    typeof input.hardWindow === 'number' && estimated > input.hardWindow

  let summary: string
  const finalizeSummary = (raw: string): string =>
    input.transformSummary ? input.transformSummary(raw) : raw

  if (skipGenerate) {
    summary = finalizeSummary(buildFallbackCheckpoint(input.messages))
  } else {
    try {
      compacted = await generateCheckpoint(input.checkpointInput)
      summary = finalizeSummary(compacted.summary)
    } catch (error) {
      if (input.checkpointInput.signal.aborted) {
        throw error
      }
      try {
        compacted = await generateCheckpoint(
          withRetryNote(input.checkpointInput),
        )
        summary = finalizeSummary(compacted.summary)
      } catch (retryError) {
        if (input.checkpointInput.signal.aborted) {
          throw retryError
        }
        summary = finalizeSummary(buildFallbackCheckpoint(input.messages))
      }
    }
  }

  let rewritten = rewriteMessages(input.messages, summary)
  let rewrittenEstimate = estimatePromptTokens(input.system, rewritten)

  if (rewrittenEstimate > input.highWater && compacted) {
    const fallbackSummary = finalizeSummary(
      buildFallbackCheckpoint(input.messages),
    )
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
