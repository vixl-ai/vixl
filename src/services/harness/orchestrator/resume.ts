import { convertToModelMessages, type ModelMessage } from 'ai'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  getSubagent,
  getTurnResponseMessages,
  listSubagentsForChat,
  markBackgroundResultsDelivered,
} from '@/services/harness/subagent/registry'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import dropTrailingAssistantMessages from '@/utils/drop-trailing-assistant-messages'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import buildWakeNudge from './build-wake-nudge'
import { patchSubagentToolResults } from './helpers'
import { persistToolRun } from './persistence'
import resolveLiveWorkspace from './resolve-workspace'
import runHarnessStream from './stream'

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSpawnToolInput = (
  messages: ModelMessage[],
  toolCallId: string,
): Record<string, unknown> | null => {
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolCallId !== toolCallId) {
        continue
      }
      if (isPlainRecord(part.input)) {
        return part.input
      }
    }
  }
  return null
}

const persistedSpawnArgs = (
  toolCallId: string,
  result: { name: string; subagentId: string },
  turnMessages: ModelMessage[] | null,
): Record<string, unknown> => {
  const fromTurn = turnMessages
    ? readSpawnToolInput(turnMessages, toolCallId)
    : null
  const record = getSubagent(result.subagentId)
  const prompt =
    (typeof fromTurn?.prompt === 'string' && fromTurn.prompt) || record?.prompt
  const mode = fromTurn?.mode
  const capabilities =
    (typeof fromTurn?.capabilities === 'string' && fromTurn.capabilities) ||
    record?.capabilities
  return {
    agentName:
      (typeof fromTurn?.agentName === 'string' && fromTurn.agentName) ||
      record?.agentName ||
      result.name,
    blocking: false,
    ...(prompt ? { prompt } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(capabilities ? { capabilities } : {}),
  }
}

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

  for (const item of completedResults) {
    onEvent({
      type: 'tool-result',
      toolCallId: item.toolCallId,
      result: item.result,
      isError: false,
    })
    await persistToolRun(
      workspace.projectSlug,
      chatId,
      item.toolCallId,
      'spawn_subagent',
      'done',
      '',
      persistedSpawnArgs(item.toolCallId, item.result, turnMessages),
      item.result,
    )
  }

  const patchedTurnMessages = turnMessages
    ? patchSubagentToolResults(turnMessages, completedResults)
    : []
  markBackgroundResultsDelivered(
    chatId,
    completedResults.map((item) => item.toolCallId),
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
  const wakeNudge: ModelMessage = {
    role: 'user',
    content: buildWakeNudge(
      completedResults.map((item) => ({
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
  }
  const modelMessages = [...baseMessages, ...patchedTurnMessages, wakeNudge]

  clearTurnResponseMessages(chatId)
  if (runningAgents.length === 0) {
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
