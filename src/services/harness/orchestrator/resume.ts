import { convertToModelMessages, type ModelMessage } from 'ai'
import type { ResumeOrchestratorInput } from '@/types/harness/orchestrator-input'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import {
  clearPendingShellResume,
  hasRunningParentBackgroundShells,
  listDeliverableShellResults,
  markShellResultsDelivered,
} from '@/services/harness/shell/registry'
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
import buildShellWakeNudge from './build-shell-wake-nudge'
import buildWakeNudge from './build-wake-nudge'
import { runningParentBackgroundShells, shellResultKey } from './shell-wake'
import { finalizeBackgroundSpawnResults } from './finalize-background-spawns'
import { patchSubagentToolResults } from './helpers'
import loadResumeOverlay from './load-resume-overlay'
import persistResumeOverlay from './persist-resume-overlay'
import resolveLiveWorkspace from './resolve-workspace'
import runHarnessStream from './stream'

export default async (input: ResumeOrchestratorInput): Promise<void> => {
  const workspace = await resolveLiveWorkspace(input)
  const {
    chatId,
    messages,
    completedResults,
    shellResults = [],
    assistantId: inputAssistantId,
    onEvent,
    ...streamInput
  } = input

  if (completedResults.length === 0 && shellResults.length === 0) {
    throw new Error('No completed subagent results to resume')
  }

  const turnMessages = getTurnResponseMessages(chatId)

  const finalizedResults =
    completedResults.length === 0
      ? []
      : await finalizeBackgroundSpawnResults(
          workspace.projectSlug,
          chatId,
          completedResults,
          onEvent,
          turnMessages,
        )

  const overlay = loadResumeOverlay(chatId)
  const patchedTurnMessages = turnMessages
    ? patchSubagentToolResults(turnMessages, finalizedResults)
    : patchSubagentToolResults(overlay.spawnMessages, finalizedResults)

  if (turnMessages && patchedTurnMessages.length > 0) {
    await persistResumeOverlay({
      projectSlug: workspace.projectSlug,
      chatId,
      spawnMessages: patchedTurnMessages,
    })
  }

  const resultKey = (toolCallId: string, summary: string): string =>
    `${toolCallId}:${summary}`
  const alreadyDelivered = new Set(overlay.deliveredResultKeys)
  const wakeResults = finalizedResults.filter(
    (item) => !alreadyDelivered.has(resultKey(item.toolCallId, item.result.summary)),
  )
  markBackgroundResultsDelivered(
    chatId,
    wakeResults.map((item) => item.toolCallId),
  )
  const chatSubagents = listSubagentsForChat(chatId)
  const runningAgents = chatSubagents
    .filter((record) => record.status === 'running')
    .map((record) => ({
      name: record.agentName.trim() || record.subagentId,
      subagentId: record.subagentId,
    }))
  const wakeContent =
    wakeResults.length > 0
      ? buildWakeNudge(
          wakeResults.map((item) => ({
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
        )
      : null
  if (wakeContent) {
    await persistResumeOverlay({
      projectSlug: workspace.projectSlug,
      chatId,
      wake: {
        content: wakeContent,
        toolCallIds: wakeResults.map((item) => item.toolCallId),
        resultKeys: wakeResults.map((item) =>
          resultKey(item.toolCallId, item.result.summary),
        ),
      },
    })
  }

  const alreadyDeliveredShell = new Set(loadResumeOverlay(chatId).deliveredResultKeys)
  const alreadyPersistedShellResults = shellResults.filter((result) =>
    alreadyDeliveredShell.has(shellResultKey(result)),
  )
  const shellWakeResults = shellResults.filter(
    (result) => !alreadyDeliveredShell.has(shellResultKey(result)),
  )
  const shellWakeContent =
    shellWakeResults.length > 0
      ? buildShellWakeNudge(shellWakeResults, runningParentBackgroundShells(chatId))
      : null
  if (shellWakeContent) {
    await persistResumeOverlay({
      projectSlug: workspace.projectSlug,
      chatId,
      wake: {
        content: shellWakeContent,
        toolCallIds: shellWakeResults.map((result) => result.toolCallId),
        resultKeys: shellWakeResults.map(shellResultKey),
      },
    })
    markShellResultsDelivered(
      chatId,
      shellWakeResults.map((result) => result.toolCallId),
    )
  }
  markShellResultsDelivered(
    chatId,
    alreadyPersistedShellResults.map((result) => result.toolCallId),
  )

  const activeContextMeta = await readChatMeta(workspace.projectSlug, chatId).catch(() => null)
  const activeContext = activeContextMeta?.activeContext
  const { messages: contextMessages, checkpointText } = filterMessagesForActiveContext(
    messages,
    activeContext,
  )
  const hasSpawnSnapshot =
    Boolean(turnMessages && turnMessages.length > 0) ||
    overlay.spawnMessages.length > 0
  const priorMessages = hasSpawnSnapshot
    ? dropTrailingAssistantMessages(contextMessages)
    : contextMessages
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
  const modelMessages: ModelMessage[] = [...baseMessages]
  if (turnMessages) {
    modelMessages.push(...patchedTurnMessages)
    if (wakeContent) {
      modelMessages.push({ role: 'user', content: wakeContent })
    }
    if (shellWakeContent) {
      modelMessages.push({ role: 'user', content: shellWakeContent })
    }
    if (alreadyPersistedShellResults.length > 0) {
      modelMessages.push({
        role: 'user',
        content: buildShellWakeNudge(
          alreadyPersistedShellResults,
          runningParentBackgroundShells(chatId),
        ),
      })
    }
  } else {
    const persisted = loadResumeOverlay(chatId)
    modelMessages.push(
      ...patchSubagentToolResults(persisted.spawnMessages, finalizedResults),
      ...persisted.wakes.map((wake) => ({
        role: 'user' as const,
        content: wake.content,
      })),
    )
  }

  clearTurnResponseMessages(chatId)
  if (
    !hasRunningSubagentsForChat(chatId) &&
    listDeliverableBackgroundResults(chatId).length === 0
  ) {
    clearPendingBackgroundResume(chatId)
  }
  if (
    !hasRunningParentBackgroundShells(chatId) &&
    listDeliverableShellResults(chatId).length === 0
  ) {
    clearPendingShellResume(chatId)
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
