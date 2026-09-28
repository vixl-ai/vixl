import { toast } from 'vue-sonner'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { FileCheckpointFilePolicy } from '@/types/harness/file-checkpoint'
import type { FileUIPart, UIMessage } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import restoreFileCheckpoints, {
  collectMutationsAfterUserMessage,
  resolveBaselinesForAgentTurn,
  resolveBaselinesForRevert,
} from '@/services/harness/restore-file-checkpoints'
import canWriteVisibleContext from './can-write-visible-context'
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
    appendedUserMessageId?: string
    continueTurnId?: string
    internal?: boolean
  }) => Promise<void>
}

export default (state: AgentHarnessState, deps: PersistenceDeps) => {
  const { options, session, status, workbench, contextUsage } = state

  const clearProviderFill = (): void => {
    if (canWriteVisibleContext(state)) {
      contextUsage.clearLastStepUsage()
    }
  }

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

  const filePartsFrom = (message: UIMessage): FileUIPart[] =>
    message.parts.filter((part): part is FileUIPart => part.type === 'file')

  const textFrom = (message: UIMessage): string =>
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => (part.type === 'text' ? part.text : ''))
      .join('')
      .trim()

  const findUserMessage = (messageId: string): UIMessage | null => {
    const item = session.timeline.value.find(
      (entry) => entry.type === 'user' && entry.message.id === messageId,
    )
    return item?.type === 'user' ? item.message : null
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

    const edited = findUserMessage(messageId)
    const files = edited ? filePartsFrom(edited) : []
    const originalText = edited ? textFrom(edited) : ''
    const text = args.newContent.trim()
    if (!text && files.length === 0) {
      toast.error('Message cannot be empty')
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
      const reuseUserMessage = files.length > 0 && !text && !originalText
      if (reuseUserMessage) {
        await session.truncateAfterUserMessage(
          options.projectSlug,
          options.chatId,
          messageId,
        )
      } else {
        await session.truncateBeforeMessage(
          options.projectSlug,
          options.chatId,
          messageId,
        )
      }
      clearProviderFill()
      state.chatStore.cancelEditMessage()
      await deps.send({
        text,
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        ...(files.length > 0 ? { files } : {}),
        ...(reuseUserMessage
          ? {
              skipUserMessage: true,
              skipUserPersist: true,
              appendedUserMessageId: messageId,
            }
          : {}),
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

    const text = textFrom(lastUser)
    const files = filePartsFrom(lastUser)
    if (!text && files.length === 0) {
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
      clearProviderFill()
      await deps.send({
        text,
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        ...(files.length > 0 ? { files } : {}),
        skipUserMessage: true,
        skipUserPersist: true,
        appendedUserMessageId: lastUser.id,
        internal: true,
      })
    } catch (err) {
      toast.error('Failed to retry', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    }
  }

  const continueLastTurn = async (args: {
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
  }): Promise<void> => {
    if (status.value === 'streaming' || status.value === 'submitted') {
      return
    }

    const turn = session.getContinuableTurn()
    const lastUser = session.getLastUserMessage()
    if (!turn || !lastUser) {
      return
    }

    try {
      await deps.send({
        text: '',
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        continueTurnId: turn.id,
        appendedUserMessageId: lastUser.id,
        skipUserMessage: true,
        skipUserPersist: true,
        internal: true,
      })
    } catch (err) {
      toast.error('Failed to continue', {
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
      clearProviderFill()
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
    const lastUser = session.getLastUserMessage()
    if (!lastUser) {
      return []
    }
    return collectMutationsAfterUserMessage(session.timeline.value, lastUser.id)
  }

  return {
    submitEditMessage,
    retryLastTurn,
    continueLastTurn,
    restoreAgentTurnFiles,
    getFileMutationsAfterMessage,
    getLastTurnFileMutations,
  }
}
