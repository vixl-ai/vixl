import { convertToModelMessages, type ModelMessage } from 'ai'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  getTurnResponseMessages,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
  listSubagentsForChat,
  markBackgroundResultsDelivered,
} from '@/services/harness/subagent/registry'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import dropTrailingAssistantMessages from '@/utils/drop-trailing-assistant-messages'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import buildWakeNudge from './build-wake-nudge'
import { finalizeBackgroundSpawnResults } from './finalize-background-spawns'
import { patchSubagentToolResults } from './helpers'
import resolveLiveWorkspace from './resolve-workspace'
import runHarnessStream from './stream'

export default async (input: ResumeOrchestratorInput): Promise<void> => {
  const workspace = resolveLiveWorkspace(input)
  const {
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

  const finalizedResults = await finalizeBackgroundSpawnResults(
    workspace.projectSlug,
    chatId,
    completedResults,
    onEvent,
    turnMessages,
  )

  const patchedTurnMessages = turnMessages
    ? patchSubagentToolResults(turnMessages, finalizedResults)
    : []
  markBackgroundResultsDelivered(
    chatId,
    finalizedResults.map((item) => item.toolCallId),
  )
  const chatSubagents = listSubagentsForChat(chatId)
  const runningAgents = chatSubagents
    .filter((record) => record.status === 'running')
    .map((record) => ({
      name: record.agentName.trim() || record.subagentId,
      subagentId: record.subagentId,
    }))
  const activeContextMeta = await readChatMeta(workspace.projectSlug, chatId).catch(() => null)
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
  // AI SDK v7 rejects system-role messages in `messages` unless allowSystemInMessages is set; keep a user turn so generateText/streamText can resume across providers.
  const modelMessages: ModelMessage[] = [...baseMessages, ...patchedTurnMessages]
  if (finalizedResults.length > 0) {
    modelMessages.push({
      role: 'user',
      content: buildWakeNudge(
        finalizedResults.map((item) => ({
          ...item,
          status:
            chatSubagents.find((record) => record.subagentId === item.result.subagentId)
              ?.status ?? 'completed',
        })),
        runningAgents,
        chatSubagents,
        {
          summariesInline: !turnMessages,
        },
      ),
    })
  }

  clearTurnResponseMessages(chatId)
  if (
    !hasRunningSubagentsForChat(chatId) &&
    listDeliverableBackgroundResults(chatId).length === 0
  ) {
    clearPendingBackgroundResume(chatId)
  }

  const lastUser = [...messages].reverse().find((message) => message.role === 'user')
  const userMessageId = lastUser?.id
  if (!userMessageId) {
    throw new Error('Cannot resume harness without a user message id for file checkpoints')
  }

  await runHarnessStream({
    ...streamInput,
    workspace,
    mentions: [],
    projectSlug: workspace.projectSlug,
    chatId,
    messages,
    modelMessages,
    userMessageId,
    onEvent,
    assistantId: inputAssistantId ?? crypto.randomUUID(),
    captureTurnMessages: true,
    permissionLevel: input.permissionLevel,
    persistPermission: input.persistPermission,
    activeContext,
  })
}
