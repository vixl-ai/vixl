import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import { rejectPendingForChat } from '@/services/harness/permission/approval-gate'
import { rejectPendingQuestionsForChat } from '@/services/harness/permission/question-gate'
import { rejectPendingMcpAuthForChat } from '@/services/mcp/mcp-auth-gate'
import {
  hasRunningParentBackgroundShells,
  listDeliverableShellResults,
  setAgentShellEventEmitter,
} from '@/services/harness/shell/registry'
import { hasRunningSubagentsForChat } from '@/services/harness/subagent/registry'
import consumeStream from './consume-stream'
import prepareStream, { type PreparedHarnessStream } from './prepare-stream'
import resolveLiveWorkspace from './resolve-workspace'

export default async (input: HarnessStreamInput): Promise<void> => {
  const workspace = await resolveLiveWorkspace(input)
  const { chatId, signal, onEvent } = input

  setAgentShellEventEmitter(chatId, onEvent)

  onEvent({
    type: 'chat-status-changed',
    projectSlug: workspace.projectSlug,
    chatId,
    status: 'running',
  })
  await updateChatMeta(workspace.projectSlug, chatId, { status: 'running', attention: null })

  let prepared: PreparedHarnessStream | null = null

  try {
    prepared = await prepareStream(input)
    await consumeStream(prepared)
  } catch (error) {
    if (!signal.aborted) {
      onEvent({
        type: 'turn-aborted',
        reason: 'error',
        partialSteps: prepared?.steps.stepCount ?? 0,
      })
      throw error
    }
  } finally {
    rejectPendingForChat(chatId)
    rejectPendingQuestionsForChat(chatId)
    rejectPendingMcpAuthForChat(chatId)
    setAgentShellEventEmitter(chatId, null)
    // Parent turn is done locally (idle) so resume can flush, but keep the
    // sidebar running while background subagents or parent terminals still need it.
    const waitingOnBackground =
      hasRunningSubagentsForChat(chatId) ||
      hasRunningParentBackgroundShells(chatId) ||
      listDeliverableShellResults(chatId).length > 0
    onEvent({
      type: 'chat-status-changed',
      projectSlug: workspace.projectSlug,
      chatId,
      status: 'idle',
    })
    if (waitingOnBackground) {
      await updateChatMeta(workspace.projectSlug, chatId, { status: 'running' })
      onEvent({
        type: 'chat-meta-changed',
        projectSlug: workspace.projectSlug,
        chatId,
        patch: { status: 'running' },
      })
    } else {
      await updateChatMeta(workspace.projectSlug, chatId, { status: 'idle' })
    }
  }
}
