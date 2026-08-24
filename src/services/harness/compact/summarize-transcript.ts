import { generateText } from 'ai'
import type { LanguageModelUsage } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import createModel from '@/services/providers/create-model'
import loadPrompt from '@/services/prompts/load-prompt'
import { resolveParsedModelForRole } from '@/services/models/resolve-model-for-role'
import { resolveSideTaskCallOptions } from '@/services/models/resolve-model-call-options'
import toCachedInstructions from '@/services/models/to-cached-instructions'
import formatUnknownError from '@/utils/format-unknown-error'
import compactBudgets from './budgets'

type SummarizeTranscriptInput = {
  settings: VixlSettings
  transcript: string
  focus?: string
  signal?: AbortSignal
  frozenSystem?: string
  chatModel?: string
}

type SummarizeTranscriptResult = {
  summary: string
  usage: LanguageModelUsage | undefined
  providerMetadata: unknown
  responseId: string | undefined
  modelRef: ModelRef
}

export default async (
  input: SummarizeTranscriptInput,
): Promise<SummarizeTranscriptResult> => {
  const { settings, transcript, focus, signal, frozenSystem, chatModel } = input

  try {
    const modelRef = resolveParsedModelForRole('compaction', settings, chatModel)
    if (!modelRef) {
      throw new Error(
        'No model configured for compaction. Set a default model in Settings.',
      )
    }

    const model = await createModel({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      settings,
    })

    const callOptions = resolveSideTaskCallOptions(settings, modelRef)
    const checkpointPrompt = loadPrompt('system/compact.md', {
      focus: focus ?? 'none',
    })
    const prompt = [
      checkpointPrompt,
      '',
      '## Conversation transcript',
      '',
      transcript,
    ].join('\n')

    const system =
      frozenSystem ??
      'You are a context compaction assistant. Summarize the conversation concisely.'

    const result = await generateText({
      model,
      system: toCachedInstructions(system, callOptions.providerOptions),
      prompt,
      maxOutputTokens: compactBudgets.COMPACT_MAX_OUTPUT_TOKENS,
      temperature: callOptions.temperature,
      topP: callOptions.topP,
      topK: callOptions.topK,
      providerOptions: callOptions.providerOptions,
      abortSignal: signal,
    })

    const summary = result.text.trim()
    if (!summary) {
      throw new Error('Compaction returned empty summary')
    }

    return {
      summary,
      usage: result.usage,
      providerMetadata: result.providerMetadata,
      responseId: result.response?.id,
      modelRef,
    }
  } catch (error) {
    throw new Error(formatUnknownError(error))
  }
}
