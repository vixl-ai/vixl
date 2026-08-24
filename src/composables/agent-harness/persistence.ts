import { toast } from 'vue-sonner'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { FileCheckpointFilePolicy } from '@/types/harness/file-checkpoint'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import restoreFileCheckpoints, {
  aggregateTurnFileDiffs,
  collectMutationsAfterUserMessage,
  resolveBaselinesForAgentTurn,
  resolveBaselinesForRevert,
} from '@/services/harness/restore-file-checkpoints'
import type { AgentHarnessState } from './types'

type PersistenceDeps = {
  send: (args: {
    text: string
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
    mentions?: ContextMention[]
    files?: FileUIPart[]
    skipUserMessage?: boolean
    skipUserPersist?: boolean
    internal?: boolean
  }) => Promise<void>
}

export default (state: AgentHarnessState, deps: PersistenceDeps) => {
  const { options, session, status, workbench } = state

  const applyFileRestore = async (
    targets: Array<{ path: string; userMessageId: string }>,
  ): Promise<boolean> => {
    const result = await restoreFileCheckpoints({
      projectSlug: options.projectSlug,
      chatId: options.chatId,
      projectRoot: options.projectRoot,
      targets,
    })
    if (result.errors.length > 0) {
      toast.error('Failed to revert some files', {
        description: result.errors
          .slice(0, 3)
          .map((entry) => `${entry.path}: ${entry.error}`)
          .join('; '),
      })
      return false
    }
    const touched = [...result.restored, ...result.deleted]
    workbench.reloadWorkspaceFiles(touched)
    const parts: string[] = []
    if (result.restored.length > 0) {
      parts.push(`restored ${result.restored.length}`)
    }
    if (result.deleted.length > 0) {
      parts.push(`removed ${result.deleted.length} created`)
    }
    if (result.skipped.length > 0) {
      parts.push(`skipped ${result.skipped.length}`)
    }
    if (parts.length > 0) {
      toast.success('Files reverted', { description: parts.join(', ') })
    }
    return true
  }

  const submitEditMessage = async (args: {
    newContent: string
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
    filePolicy?: FileCheckpointFilePolicy
  }): Promise<void> => {
    const messageId = state.chatStore.editingMessageId.value
    if (!messageId) {
      return
    }

    const text = args.newContent.trim()
    if (!text) {
      return
    }

    try {
      if (args.filePolicy === 'revert') {
        const targets = resolveBaselinesForRevert(session.timeline.value, messageId)
        const ok = await applyFileRestore(targets)
        if (!ok) {
          return
        }
      }
      await session.truncateBeforeMessage(
        options.projectSlug,
        options.chatId,
        messageId,
      )
      state.chatStore.cancelEditMessage()
      await deps.send({
        text,
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        internal: true,
      })
    } catch (err) {
      toast.error('Failed to edit message', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const retryLastTurn = async (args: {
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
    filePolicy?: FileCheckpointFilePolicy
  }): Promise<void> => {
    if (status.value === 'streaming' || status.value === 'submitted') {
      return
    }

    const lastUser = session.getLastUserMessage()
    if (!lastUser) {
      return
    }

    const text = lastUser.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()
    if (!text) {
      return
    }

    try {
      if (args.filePolicy === 'revert') {
        const targets = resolveBaselinesForRevert(session.timeline.value, lastUser.id)
        const ok = await applyFileRestore(targets)
        if (!ok) {
          return
        }
      }
      await session.truncateAfterLastUserMessage(
        options.projectSlug,
        options.chatId,
      )
      await deps.send({
        text,
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        skipUserMessage: true,
        skipUserPersist: true,
        internal: true,
      })
    } catch (err) {
      toast.error('Failed to retry', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const restoreAgentTurnFiles = async (turnId: string): Promise<boolean> => {
    const resolved = resolveBaselinesForAgentTurn(session.timeline.value, turnId)
    if (!resolved.precedingUserMessageId) {
      toast.error('Cannot restore files', {
        description: 'No preceding user message found for this turn.',
      })
      return false
    }
    const ok = await applyFileRestore(resolved.targets)
    if (!ok) {
      return false
    }
    try {
      await session.truncateAfterUserMessage(
        options.projectSlug,
        options.chatId,
        resolved.precedingUserMessageId,
      )
      return true
    } catch (err) {
      toast.error('Files reverted but chat truncate failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
      return false
    }
  }

  const getFileMutationsAfterMessage = (messageId: string) =>
    collectMutationsAfterUserMessage(session.timeline.value, messageId)

  const getLastTurnFileMutations = () => {
    for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
      const item = session.timeline.value[index]
      if (item?.type === 'agent-turn') {
        return aggregateTurnFileDiffs(item.turn)
      }
    }
    return []
  }

  return {
    submitEditMessage,
    retryLastTurn,
    restoreAgentTurnFiles,
    getFileMutationsAfterMessage,
    getLastTurnFileMutations,
  }
}
