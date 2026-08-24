import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import compactSession from '@/services/harness/compact-session'
import writeHandoff from '@/services/harness/write-handoff'
import { createChat } from '@/services/vixl/vixl-tauri'
import { setPendingChatMessage } from '@/services/chat/pending-message'
import chatRouteFor from '@/utils/chat-route-for'
import formatUnknownError from '@/utils/format-unknown-error'
import router from '@/router'
import type { AgentHarnessState } from './types'

type SessionOpsDeps = {
  handleEvent: (event: HarnessEvent) => void
}

export default (state: AgentHarnessState, deps: SessionOpsDeps) => {
  const { options, session, config, status, contextUsage } = state

  const compactChat = async (focus?: string): Promise<void> => {
    if (status.value === 'streaming' || status.value === 'submitted') {
      toast.error('Cannot compact while agent is running', {
        description: 'Stop the agent first, then compact.',
      })
      return
    }

    const meta = session.meta.value
    if (!meta) {
      toast.error('Chat is not ready yet')
      return
    }

    const projectRoot = options.projectRoot
    if (!projectRoot) {
      toast.error('No project root available for compaction')
      return
    }

    try {
      const result = await compactSession({
        projectSlug: options.projectSlug,
        chatId: options.chatId,
        projectRoot,
        settings: config.effectiveSettings.value,
        messages: session.messages.value,
        focus,
        frozenSystem: undefined,
        chatModel: meta.model,
        turnId: session.activeTurnId.value ?? `session:${options.chatId}`,
        onEvent: deps.handleEvent,
      })
      session.appendLocalCompaction(result.summary, focus ?? null)
      session.patchMetaActiveContext({
        checkpointLineId: result.checkpointLineId,
        includeFromCreatedAt: result.includeFromCreatedAt,
        summary: result.summary,
      })
      contextUsage.clearLastStepUsage()
      toast.success('Context compacted', {
        description: 'Conversation history has been summarized.',
      })
    } catch (err) {
      toast.error('Compaction failed', {
        description: formatUnknownError(err),
      })
    }
  }

  const createHandoff = async (): Promise<void> => {
    if (status.value === 'streaming' || status.value === 'submitted') {
      toast.error('Cannot create handoff while agent is running', {
        description: 'Stop the agent first.',
      })
      return
    }

    const meta = session.meta.value
    if (!meta) {
      toast.error('Chat is not ready yet')
      return
    }

    const projectRoot = options.projectRoot

    let summary = meta.activeContext?.summary
    if (!summary) {
      try {
        const compactResult = await compactSession({
          projectSlug: options.projectSlug,
          chatId: options.chatId,
          projectRoot,
          settings: config.effectiveSettings.value,
          messages: session.messages.value,
          chatModel: meta.model,
          turnId: session.activeTurnId.value ?? `session:${options.chatId}`,
          onEvent: deps.handleEvent,
        })
        summary = compactResult.summary
        session.appendLocalCompaction(compactResult.summary, null)
        session.patchMetaActiveContext({
          checkpointLineId: compactResult.checkpointLineId,
          includeFromCreatedAt: compactResult.includeFromCreatedAt,
          summary: compactResult.summary,
        })
      } catch (err) {
        toast.error('Handoff failed: could not generate summary', {
          description: formatUnknownError(err),
        })
        return
      }
    }

    try {
      await writeHandoff({
        summary,
        chatId: options.chatId,
      })
    } catch (err) {
      toast.error('Handoff failed: could not write file', {
        description: formatUnknownError(err),
      })
      return
    }

    try {
      const newChat = await createChat({
        projectSlug: options.projectSlug,
        projectRoot,
        mode: meta.mode,
        model: meta.model,
        title: `Handoff from ${meta.title}`,
      })

      setPendingChatMessage({
        text: `Continuing from handoff:\n\n${summary}`,
        mode: meta.mode,
        model: meta.model,
      })

      await router.push(chatRouteFor(options.projectSlug, newChat.id))
      toast.success('Handoff created', {
        description: 'New chat opened with context from previous session.',
      })
    } catch (err) {
      toast.error('Handoff failed: could not create new chat', {
        description: formatUnknownError(err),
      })
    }
  }

  return { compactChat, createHandoff }
}
