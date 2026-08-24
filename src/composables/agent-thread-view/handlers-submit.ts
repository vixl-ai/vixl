import { toast } from 'vue-sonner'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { ContextMention } from '@/types/harness/context-mention'
import type { FileCheckpointFilePolicy } from '@/types/harness/file-checkpoint'
import type { FileUIPart } from 'ai'
import type { AgentThreadViewState } from './types'

export const createSubmitHandlers = (state: AgentThreadViewState) => {
  const handleSubmit = async (payload: {
    text: string
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
    files?: FileUIPart[]
    mentions?: ContextMention[]
  }): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!payload.model) {
      toast.error('Select a model before sending')
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet', {
        description: 'Wait for the chat to finish loading.',
      })
      return
    }
    await state.harness.value.send({
      text: payload.text,
      mode: payload.mode,
      model: payload.model,
      reasoning: payload.reasoning,
      files: payload.files,
      mentions: payload.mentions,
    })
    await state.fleetSidebar.refreshSlug(state.projectSlug.value)
  }

  const handleSubmitEdit = async (payload: {
    text: string
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
  }): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet', {
        description: 'Wait for the chat to finish loading.',
      })
      return
    }
    const messageId = state.chatStore.editingMessageId.value
    const mutations =
      messageId ? state.harness.value.getFileMutationsAfterMessage(messageId) : []
    if (mutations.length > 0) {
      state.pendingFilePolicyAction.value = {
        kind: 'edit',
        text: payload.text,
        mode: payload.mode,
        model: payload.model,
        reasoning: payload.reasoning,
      }
      state.filePolicyTitle.value = 'Submit edited message?'
      state.filePolicyEmphasizeRevert.value = false
      state.filePolicyChanges.value = mutations
      state.filePolicyOpen.value = true
      return
    }
    await state.harness.value.submitEditMessage({
      newContent: payload.text,
      mode: payload.mode,
      model: payload.model,
      reasoning: payload.reasoning,
      filePolicy: 'keep',
    })
    await state.fleetSidebar.refreshSlug(state.projectSlug.value)
  }

  const runPendingFilePolicy = async (
    filePolicy: FileCheckpointFilePolicy,
  ): Promise<void> => {
    const pending = state.pendingFilePolicyAction.value
    state.pendingFilePolicyAction.value = null
    if (!pending || !state.harness.value) {
      return
    }
    if (pending.kind === 'edit') {
      await state.harness.value.submitEditMessage({
        newContent: pending.text,
        mode: pending.mode,
        model: pending.model,
        reasoning: pending.reasoning,
        filePolicy,
      })
      await state.fleetSidebar.refreshSlug(state.projectSlug.value)
      return
    }
    await state.harness.value.retryLastTurn({
      mode: pending.mode,
      model: pending.model,
      filePolicy,
    })
  }

  const handleFilePolicyKeep = async (): Promise<void> => {
    try {
      await runPendingFilePolicy('keep')
    } catch (error) {
      toast.error('Failed to continue', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleFilePolicyRevert = async (): Promise<void> => {
    try {
      await runPendingFilePolicy('revert')
    } catch (error) {
      toast.error('Failed to revert files', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleRestoreFiles = async (turnId: string): Promise<void> => {
    if (!state.harness.value) {
      return
    }
    try {
      await state.harness.value.restoreAgentTurnFiles(turnId)
      await state.fleetSidebar.refreshSlug(state.projectSlug.value)
    } catch (error) {
      toast.error('Failed to restore files', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleStop = async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    try {
      await state.harness.value?.stop()
    } catch (error) {
      toast.error('Failed to stop agent', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const handleStopSubagent = (subagentId: string): void => {
    state.harness.value?.stopSubagent(subagentId)
  }

  const handleRetry = async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet', {
        description: 'Wait for the chat to finish loading.',
      })
      return
    }
    const lastRun = state.harness.value.lastRunConfig.value
    const model =
      lastRun?.model ?? state.paintedSession.value?.meta.value?.model
    const mode =
      lastRun?.mode ?? state.paintedSession.value?.meta.value?.mode ?? 'agent'
    if (!model) {
      toast.error('Select a model before retrying')
      return
    }
    const mutations = state.harness.value.getLastTurnFileMutations()
    if (mutations.length > 0) {
      state.pendingFilePolicyAction.value = { kind: 'retry', mode, model }
      state.filePolicyTitle.value = 'Retry this turn?'
      state.filePolicyEmphasizeRevert.value = true
      state.filePolicyChanges.value = mutations
      state.filePolicyOpen.value = true
      return
    }
    await state.harness.value.retryLastTurn({
      mode,
      model,
      filePolicy: 'keep',
    })
  }

  const handlePermissionLevelChange = (level: PermissionLevel): void => {
    state.permissionLevelTouched.value = true
    state.sessionPermissionLevel.value = level
    state.harness.value?.setPermissionLevel(level)
  }

  const handleCompact = async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet')
      return
    }
    await state.harness.value.compactChat()
  }

  const handleHandoff = async (): Promise<void> => {
    if (state.isSubagentView.value) {
      return
    }
    if (!state.harness.value) {
      toast.error('Chat is not ready yet')
      return
    }
    await state.harness.value.createHandoff()
  }

  return {
    handleSubmit,
    handleSubmitEdit,
    handleFilePolicyKeep,
    handleFilePolicyRevert,
    handleRestoreFiles,
    handleStop,
    handleStopSubagent,
    handleRetry,
    handlePermissionLevelChange,
    handleCompact,
    handleHandoff,
  }
}
