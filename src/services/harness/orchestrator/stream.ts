import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import { releaseLocksForChat } from '@/services/browser/registry'
import { rejectPendingForChat } from '@/services/harness/permission/approval-gate'
import { rejectPendingQuestionsForChat } from '@/services/harness/permission/question-gate'
import { rejectPendingMcpAuthForChat } from '@/services/mcp/mcp-auth-gate'
import { setAgentShellEventEmitter } from '@/services/harness/shell/registry'
import { hasRunningSubagentsForChat } from '@/services/harness/subagent/registry'
import consumeStream from './consume-stream'
import prepareStream, { type PreparedHarnessStream } from './prepare-stream'

export default async (input: HarnessStreamInput): Promise<void> => {
  const { projectSlug, chatId, signal, onEvent } = input

  setAgentShellEventEmitter(chatId, onEvent)

  onEvent({
    type: 'chat-status-changed',
    projectSlug,
    chatId,
    status: 'running',
  })
  await updateChatMeta(projectSlug, chatId, { status: 'running', attention: null })

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
    // sidebar "running" while background subagents are still working.
    const waitingOnBackground = hasRunningSubagentsForChat(chatId)
    if (signal.aborted) {
      releaseLocksForChat(chatId, 'aborted')
    } else if (!waitingOnBackground) {
      releaseLocksForChat(chatId, 'run_complete')
    }
    onEvent({
      type: 'chat-status-changed',
      projectSlug,
      chatId,
      status: 'idle',
    })
    if (waitingOnBackground) {
      await updateChatMeta(projectSlug, chatId, { status: 'running' })
      onEvent({
        type: 'chat-meta-changed',
        projectSlug,
        chatId,
        patch: { status: 'running' },
      })
    } else {
      await updateChatMeta(projectSlug, chatId, { status: 'idle' })
    }
  }
}
