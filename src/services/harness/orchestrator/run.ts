import { convertToModelMessages, type ModelMessage } from 'ai'
import type { MentionHighlight } from '@/types/chat/mention-highlight'
import type { OrchestratorInput } from '@/types/harness/orchestrator-input'
import { mentionHighlightSchema } from '@/schemas/mention-highlight'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import runSideTask from '@/services/harness/run-side-task'
import { isDefaultChatTitle } from '@/utils/derive-chat-title'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import { nowIso } from './helpers'
import { persistLine } from './persistence'
import runHarnessStream from './stream'

export default async (input: OrchestratorInput): Promise<void> => {
  const {
    projectSlug,
    chatId,
    messages,
    userText,
    skipUserPersist = false,
    assistantId: inputAssistantId,
    ...streamInput
  } = input

  const existingUser = [...messages]
    .reverse()
    .find(
      (message) =>
        message.role === 'user' &&
        message.parts.some(
          (part) => part.type === 'text' && part.text === userText,
        ),
    )

  const existingUserMeta =
    existingUser?.metadata && typeof existingUser.metadata === 'object'
      ? (existingUser.metadata as Record<string, unknown>)
      : null

  const mentionHighlightsParsed = mentionHighlightSchema
    .array()
    .safeParse(existingUserMeta?.mentionHighlights)
  const mentionHighlights: MentionHighlight[] | undefined =
    mentionHighlightsParsed.success && mentionHighlightsParsed.data.length > 0
      ? mentionHighlightsParsed.data
      : undefined

  const userLine = {
    id: existingUser?.id ?? crypto.randomUUID(),
    role: 'user' as const,
    parts: existingUser?.parts ?? [{ type: 'text' as const, text: userText }],
    createdAt: nowIso(),
    model:
      typeof existingUserMeta?.model === 'string'
        ? existingUserMeta.model
        : `${input.providerId}::${input.modelId}`,
    ...(mentionHighlights ? { mentionHighlights } : {}),
  }

  if (!skipUserPersist) {
    await persistLine(projectSlug, chatId, userLine)
  }

  const isFirstUserMessage =
    messages.filter((message) => message.role === 'user').length === 1

  const assistantId = inputAssistantId ?? crypto.randomUUID()

  const emitTitleChange = (title: string): void => {
    input.onEvent({
      type: 'chat-meta-changed',
      projectSlug,
      chatId,
      patch: { title },
    })
  }

  if (isFirstUserMessage) {
    // Keep the short "New Agent" placeholder while naming runs. Never copy the
    // user prompt into the sidebar title (including sync fallbacks).
    runSideTask({
      projectSlug,
      chatId,
      prompt: userText,
      settings: input.settings,
      fallbackProviderId: input.providerId,
      fallbackModelId: input.modelId,
      turnId: assistantId,
      onEvent: input.onEvent,
    }).then((generatedTitle) => {
      if (generatedTitle && !isDefaultChatTitle(generatedTitle)) {
        emitTitleChange(generatedTitle)
      }
    })
  }

  const activeContextMeta = await readChatMeta(projectSlug, chatId).catch(() => null)
  const activeContext = activeContextMeta?.activeContext
  const { messages: contextMessages, checkpointText } = filterMessagesForActiveContext(
    messages,
    activeContext,
  )
  const visionModel = await createModel({
    providerId: input.providerId,
    modelId: input.modelId,
    settings: input.settings,
  })
  const supportsVision = await resolveModelVision({
    model: visionModel,
    providerId: input.providerId,
    modelId: input.modelId,
    settings: input.settings,
  })
  const recentModelMessages = await convertToModelMessages(
    await prepareMessagesForModelVision(contextMessages, supportsVision),
  )
  const effectiveModelMessages: ModelMessage[] = checkpointText
    ? [
        {
          role: 'user',
          content: checkpointText,
        },
        ...recentModelMessages,
      ]
    : recentModelMessages

  await runHarnessStream({
    ...streamInput,
    projectSlug,
    chatId,
    messages,
    modelMessages: effectiveModelMessages,
    userMessageId: userLine.id,
    assistantId,
    captureTurnMessages: true,
    standalone: input.standalone,
    permissionLevel: input.permissionLevel,
    persistPermission: input.persistPermission,
    activeContext,
  })
}
