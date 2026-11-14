import { convertToModelMessages, type ModelMessage } from 'ai'
import { toast } from 'vue-sonner'
import type { MentionHighlight } from '@/types/chat/mention-highlight'
import type { OrchestratorInput } from '@/types/harness/orchestrator-input'
import { mentionHighlightSchema } from '@/schemas/mention-highlight'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import runSideTask from '@/services/harness/run-side-task'
import {
  getTurnResponseMessages,
  listSubagentsForChat,
} from '@/services/harness/subagent/registry'
import { isDefaultChatTitle } from '@/utils/derive-chat-title'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import buildShellWakeNudge from './build-shell-wake-nudge'
import buildWakeNudge from './build-wake-nudge'
import { finalizeBackgroundSpawnResults } from './finalize-background-spawns'
import { nowIso } from './helpers'
import loadResumeOverlay from './load-resume-overlay'
import persistResumeOverlay from './persist-resume-overlay'
import { persistLine } from './persistence'
import resolveLiveWorkspace from './resolve-workspace'
import { runningParentBackgroundShells, shellResultKey } from './shell-wake'
import runHarnessStream from './stream'

export default async (input: OrchestratorInput): Promise<void> => {
  const workspace = await resolveLiveWorkspace(input)
  const {
    chatId,
    messages,
    userText,
    appendedUserMessageId,
    skipUserPersist = false,
    assistantId: inputAssistantId,
    prefinishedBackgroundResults,
    prefinishedShellResults,
    ...streamInput
  } = input

  const existingUserById = appendedUserMessageId
    ? messages.find(
        (message) =>
          message.role === 'user' && message.id === appendedUserMessageId,
      )
    : undefined

  const existingUser =
    existingUserById ??
    [...messages]
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
    await persistLine(workspace.projectSlug, chatId, userLine)
  }

  const isFirstUserMessage =
    messages.filter((message) => message.role === 'user').length === 1

  const assistantId = inputAssistantId ?? crypto.randomUUID()

  const emitTitleChange = (title: string): void => {
    input.onEvent({
      type: 'chat-meta-changed',
      projectSlug: workspace.projectSlug,
      chatId,
      patch: { title },
    })
  }

  const shouldNameChat = isFirstUserMessage && userText.trim().length > 0
  let titleTaskStarted = false

  const startTitleTask = (): void => {
    if (titleTaskStarted) {
      return
    }
    titleTaskStarted = true
    // Keep the short "New Agent" placeholder while naming runs. Never copy
    // the user prompt into the sidebar title (including sync fallbacks).
    // Naming waits until the main stream is producing content. When
    // models.title is unset the title task falls back to the chat model,
    // and a title request sent before the main one makes serialized or
    // single slot providers queue the main prompt behind it: the turn then
    // looks stalled until the title finishes.
    runSideTask({
      projectSlug: workspace.projectSlug,
      chatId,
      prompt: userText,
      settings: input.settings,
      fallbackProviderId: input.providerId,
      fallbackModelId: input.modelId,
      turnId: assistantId,
      onEvent: input.onEvent,
    })
      .then((generatedTitle) => {
        if (generatedTitle && !isDefaultChatTitle(generatedTitle)) {
          emitTitleChange(generatedTitle)
        }
      })
      .catch((error: unknown) => {
        toast.error('Failed to generate chat title', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
  }

  const activeContextMeta = await readChatMeta(workspace.projectSlug, chatId).catch(() => null)
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

  let modelMessages = effectiveModelMessages
  const extraWakes: ModelMessage[] = []
  if (prefinishedBackgroundResults && prefinishedBackgroundResults.length > 0) {
    const finalizedResults = await finalizeBackgroundSpawnResults(
      workspace.projectSlug,
      chatId,
      prefinishedBackgroundResults,
      input.onEvent,
      getTurnResponseMessages(chatId),
    )
    if (finalizedResults.length > 0) {
      const chatSubagents = listSubagentsForChat(chatId)
      const runningAgents = chatSubagents
        .filter((record) => record.status === 'running')
        .map((record) => ({
          name: record.agentName.trim() || record.subagentId,
          subagentId: record.subagentId,
        }))
      extraWakes.push({
        role: 'user',
        content: buildWakeNudge(
          finalizedResults.map((item) => ({
            ...item,
            status:
              chatSubagents.find(
                (record) => record.subagentId === item.result.subagentId,
              )?.status ?? 'completed',
          })),
          runningAgents,
          chatSubagents,
          {
            summariesInline: true,
          },
        ),
      })
    }
  }
  if (prefinishedShellResults && prefinishedShellResults.length > 0) {
    const alreadyDelivered = new Set(loadResumeOverlay(chatId).deliveredResultKeys)
    const unseenShellResults = prefinishedShellResults.filter(
      (result) => !alreadyDelivered.has(shellResultKey(result)),
    )
    const running = runningParentBackgroundShells(chatId)
    if (unseenShellResults.length > 0) {
      await persistResumeOverlay({
        projectSlug: workspace.projectSlug,
        chatId,
        wake: {
          content: buildShellWakeNudge(unseenShellResults, running),
          toolCallIds: unseenShellResults.map((result) => result.toolCallId),
          resultKeys: unseenShellResults.map(shellResultKey),
        },
      })
    }
    extraWakes.push({
      role: 'user',
      content: buildShellWakeNudge(prefinishedShellResults, running),
    })
  }
  if (extraWakes.length > 0) {
    modelMessages = [...effectiveModelMessages, ...extraWakes]
  }

  await runHarnessStream({
    ...streamInput,
    onEvent: (event) => {
      if (
        shouldNameChat &&
        !titleTaskStarted &&
        (event.type === 'text-delta' ||
          event.type === 'reasoning-delta' ||
          event.type === 'tool-input-start' ||
          event.type === 'tool-start')
      ) {
        startTitleTask()
      }
      return streamInput.onEvent(event)
    },
    workspace,
    projectSlug: workspace.projectSlug,
    chatId,
    messages,
    modelMessages,
    userMessageId: userLine.id,
    assistantId,
    captureTurnMessages: true,
    standalone: input.standalone,
    permissionLevel: input.permissionLevel,
    persistPermission: input.persistPermission,
    activeContext,
  })
  if (shouldNameChat) {
    startTitleTask()
  }
}
