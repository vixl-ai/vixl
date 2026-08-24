import { generateText } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { MODEL_REF_SEPARATOR, type ModelRef } from '@/types/models/model-ref'
import createModel from '@/services/providers/create-model'
import captureBillableUsage from '@/services/billing/capture-billable-usage'
import loadPrompt from '@/services/prompts/load-prompt'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { resolveParsedModelForRole } from '@/services/models/resolve-model-for-role'
import { resolveSideTaskCallOptions } from '@/services/models/resolve-model-call-options'
import { isDefaultChatTitle, isPromptEchoTitle } from '@/utils/derive-chat-title'
import { toast } from 'vue-sonner'

/** Cap title-model input so huge pastes are not fully re-sent for naming. */
const TITLE_PROMPT_MAX_CHARS = 2000

/** Titles are max ~6 words; keep generation cheap. */
const TITLE_MAX_OUTPUT_TOKENS = 64

export type ChatTitleTaskInput = {
  projectSlug: string
  chatId: string
  prompt: string
  settings: VixlSettings
  /** Used when models.title and models.default are unset (per-chat model pick). */
  fallbackProviderId?: string
  fallbackModelId?: string
  /** AgentTurn.id when naming runs during a turn; else session sentinel. */
  turnId?: string
  onEvent?: (event: HarnessEvent) => void
}

const truncateTitlePrompt = (prompt: string): string => {
  if (prompt.length <= TITLE_PROMPT_MAX_CHARS) {
    return prompt
  }
  return prompt.slice(0, TITLE_PROMPT_MAX_CHARS)
}

const stripThinkBlocks = (text: string): string =>
  text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim()

const cleanGeneratedTitle = (raw: string): string => {
  const withoutThink = stripThinkBlocks(raw)
  const line =
    withoutThink
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .at(-1) ?? ''
  return line.replace(/^["']|["']$/g, '').slice(0, 80).trim()
}

const modelRefKey = (ref: Pick<ModelRef, 'providerId' | 'modelId'>): string =>
  `${ref.providerId}${MODEL_REF_SEPARATOR}${ref.modelId}`

export default async (input: ChatTitleTaskInput): Promise<string | null> => {
  if (input.settings['chat.autoTitle'] === false) {
    return null
  }

  const chatFallback: ModelRef | null =
    input.fallbackProviderId && input.fallbackModelId
      ? { providerId: input.fallbackProviderId, modelId: input.fallbackModelId }
      : null

  const primaryModel =
    resolveParsedModelForRole('title', input.settings) ?? chatFallback
  if (!primaryModel) {
    return null
  }

  const generateTitleWithModel = async (modelRef: ModelRef): Promise<string | null> => {
    const model = await createModel({
      providerId: modelRef.providerId,
      modelId: modelRef.modelId,
      settings: input.settings,
      // Thinking models spend the whole max_tokens budget on reasoning and return
      // empty content (confirmed with local Qwen at max_tokens=64/512).
      disableThinking: true,
    })
    const callOptions = resolveSideTaskCallOptions(input.settings, modelRef)
    const maxOutputTokens = Math.min(
      callOptions.maxOutputTokens ?? TITLE_MAX_OUTPUT_TOKENS,
      TITLE_MAX_OUTPUT_TOKENS,
    )

    const result = await generateText({
      model,
      maxOutputTokens,
      temperature: callOptions.temperature ?? 0.4,
      topP: callOptions.topP,
      topK: callOptions.topK,
      frequencyPenalty: callOptions.frequencyPenalty,
      presencePenalty: callOptions.presencePenalty,
      seed: callOptions.seed,
      providerOptions: callOptions.providerOptions,
      prompt: loadPrompt('side-tasks/chat-title.md', {
        prompt: truncateTitlePrompt(input.prompt),
      }),
    })

    const turnId = input.turnId ?? `session:${input.chatId}`
    if (input.onEvent) {
      await captureBillableUsage({
        projectSlug: input.projectSlug,
        chatId: input.chatId,
        turnId,
        source: 'title',
        providerId: modelRef.providerId,
        modelId: modelRef.modelId,
        usage: result.usage,
        providerMetadata: result.providerMetadata,
        responseId: result.response?.id,
        settings: input.settings,
        onEvent: input.onEvent,
      })
    }

    const title = cleanGeneratedTitle(result.text)
    if (!title || isDefaultChatTitle(title) || isPromptEchoTitle(title, input.prompt)) {
      return null
    }
    return title
  }

  const persistTitle = async (title: string): Promise<string> => {
    await updateChatMeta(input.projectSlug, input.chatId, { title })
    await refreshFleetSidebar()
    return title
  }

  const toastTitleFailure = (error: unknown): null => {
    toast.error('Failed to generate chat title', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    return null
  }

  let title: string | null
  try {
    title = await generateTitleWithModel(primaryModel)
  } catch (primaryError) {
    const canRetry =
      chatFallback !== null &&
      modelRefKey(chatFallback) !== modelRefKey(primaryModel)

    if (!canRetry) {
      return toastTitleFailure(primaryError)
    }

    try {
      title = await generateTitleWithModel(chatFallback)
    } catch (fallbackError) {
      return toastTitleFailure(fallbackError)
    }
  }

  if (!title) {
    return null
  }

  try {
    return await persistTitle(title)
  } catch (error) {
    return toastTitleFailure(error)
  }
}
