import { convertToModelMessages, type ModelMessage } from 'ai'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  getTurnResponseMessages,
} from '@/services/harness/subagent/registry'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import dropTrailingAssistantMessages from '@/utils/drop-trailing-assistant-messages'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import { patchSubagentToolResults } from './helpers'
import { persistToolRun } from './persistence'
import runHarnessStream from './stream'

export default async (input: ResumeOrchestratorInput): Promise<void> => {
  const {
    projectSlug,
    chatId,
    messages,
    completedResults,
    assistantId: inputAssistantId,
    onEvent,
    ...streamInput
  } = input

  if (completedResults.length === 0) {
    throw new Error('No completed subagent results to resume')
  }

  const turnMessages = getTurnResponseMessages(chatId)
  if (!turnMessages) {
    throw new Error('No pending subagent turn to resume')
  }

  for (const item of completedResults) {
    onEvent({
      type: 'tool-result',
      toolCallId: item.toolCallId,
      result: item.result,
      isError: false,
    })
    await persistToolRun(
      projectSlug,
      chatId,
      item.toolCallId,
      'spawn_subagent',
      'done',
      '',
      { agentName: item.result.name, blocking: false },
      item.result,
    )
  }

  const patchedTurnMessages = patchSubagentToolResults(
    turnMessages,
    completedResults,
  )
  const activeContextMeta = await readChatMeta(projectSlug, chatId).catch(() => null)
  const activeContext = activeContextMeta?.activeContext
  const { messages: contextMessages, checkpointText } = filterMessagesForActiveContext(
    messages,
    activeContext,
  )
  const priorMessages = dropTrailingAssistantMessages(contextMessages)
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
    await prepareMessagesForModelVision(priorMessages, supportsVision),
  )
  const baseMessages: ModelMessage[] = checkpointText
    ? [{ role: 'user', content: checkpointText }, ...recentModelMessages]
    : recentModelMessages
  const wakeNudge: ModelMessage = {
    role: 'user',
    content:
      'All background subagents finished. Their completed summaries are in the spawn_subagent tool results above. Answer the user now using those results. Do not say the subagents are still running.',
  }
  const modelMessages = [...baseMessages, ...patchedTurnMessages, wakeNudge]

  clearTurnResponseMessages(chatId)
  clearPendingBackgroundResume(chatId)

  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const userMessageId = lastUser?.id
  if (!userMessageId) {
    throw new Error('Cannot resume harness without a user message id for file checkpoints')
  }

  await runHarnessStream({
    ...streamInput,
    mentions: [],
    projectSlug,
    chatId,
    messages,
    modelMessages,
    userMessageId,
    onEvent,
    assistantId: inputAssistantId ?? crypto.randomUUID(),
    captureTurnMessages: false,
    permissionLevel: input.permissionLevel,
    persistPermission: input.persistPermission,
    activeContext,
  })
}
