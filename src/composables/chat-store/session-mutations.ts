import { computed } from 'vue'
import type { UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { AgentTurnError } from '@/types/chat/agent-turn-error'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { TodoItem } from '@/types/harness/harness-event'
import { resolveQuestion } from '@/services/harness/permission/question-gate'
import { chatMetaSchema } from '@/schemas/chat-meta'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import {
  truncateChatLogAfterLastUser,
  truncateChatLogAfterUserMessage,
  truncateChatLogBeforeMessage,
} from '@/services/chat/truncate-chat-log'
import {
  clearActiveTurnState,
  extractUserMessageText,
  getActiveSession,
  mapMeta,
  todosFromTimeline,
} from './helpers'
import { upsertTodoTimelineItem } from './timeline'
import {
  rebuildMessagesFromTimeline,
  updateTimelineTurn,
} from './message-parsing'
import createSessionAgentOps from './session-agent-ops'
import createSessionSubagentOps from './session-subagent-ops'
import type { ChatSession, SessionMutations } from './types'

const sessionBindings = new WeakMap<ChatSession, SessionMutations>()

export const createSessionMutations = (session: ChatSession): SessionMutations => {
  const agent = createSessionAgentOps(session)
  const subagent = createSessionSubagentOps(session)

  const findUserMessage = (messageId: string): UIMessage | null => {
    const item = session.timeline.value.find(
      (entry) => entry.type === 'user' && entry.message.id === messageId,
    )
    return item?.type === 'user' ? item.message : null
  }

  const truncateTimelineBeforeMessage = (messageId: string): void => {
    const index = session.timeline.value.findIndex(
      (entry) => entry.type === 'user' && entry.message.id === messageId,
    )
    if (index < 0) {
      return
    }
    const nextTimeline = session.timeline.value.slice(0, index)
    session.timeline.value = nextTimeline
    session.messages.value = rebuildMessagesFromTimeline(nextTimeline)
    clearActiveTurnState(session)
  }

  const truncateTimelineAfterLastUserMessage = (): void => {
    let lastUserIndex = -1
    for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
      if (session.timeline.value[index]?.type === 'user') {
        lastUserIndex = index
        break
      }
    }
    if (lastUserIndex < 0) {
      return
    }
    const nextTimeline = session.timeline.value.slice(0, lastUserIndex + 1)
    session.timeline.value = nextTimeline
    session.messages.value = rebuildMessagesFromTimeline(nextTimeline)
    clearActiveTurnState(session)
  }

  const truncateTimelineAfterUserMessage = (messageId: string): void => {
    const index = session.timeline.value.findIndex(
      (entry) => entry.type === 'user' && entry.message.id === messageId,
    )
    if (index < 0) {
      return
    }
    const nextTimeline = session.timeline.value.slice(0, index + 1)
    session.timeline.value = nextTimeline
    session.messages.value = rebuildMessagesFromTimeline(nextTimeline)
    clearActiveTurnState(session)
  }

  return {
    meta: computed(() => session.meta.value),
    messages: computed(() => session.messages.value),
    timeline: computed(() => session.timeline.value),
    pendingQuestion: computed(() => session.pendingQuestion.value),
    todos: computed(() => todosFromTimeline(session.timeline.value)),
    patchMeta: (patch: Partial<ChatMeta>): void => {
      if (!session.meta.value) {
        return
      }
      session.meta.value = chatMetaSchema.parse({ ...session.meta.value, ...patch })
    },
    reloadMeta: async (projectSlug: string, chatId: string): Promise<void> => {
      const record = await readChatMeta(projectSlug, chatId)
      session.meta.value = mapMeta(record)
    },
    appendLocalMessage: (message: UIMessage): void => {
      session.messages.value = [...session.messages.value, message]
      if (message.role === 'user') {
        session.timeline.value = [...session.timeline.value, { type: 'user', message }]
      }
    },
    startAgentTurn: (turnId: string): void => {
      agent.flushPendingStreamDeltas()
      session.turnIdRemap.clear()
      session.activeTurnId.value = turnId
      session.activeStepId.value = null
      session.pendingStepText.value = ''
      const turn: AgentTurn = {
        id: turnId,
        steps: [],
        text: '',
        createdAt: new Date().toISOString(),
      }
      session.timeline.value = [...session.timeline.value, { type: 'agent-turn', turn }]
    },
    startAgentStep: agent.startAgentStep,
    finishAgentStep: agent.finishAgentStep,
    appendLocalTextDelta: agent.appendLocalTextDelta,
    appendLocalReasoningDelta: agent.appendLocalReasoningDelta,
    upsertLocalToolRun: agent.upsertLocalToolRun,
    finishAgentTurn: agent.finishAgentTurn,
    flushPendingStreamDeltas: agent.flushPendingStreamDeltas,
    disposePendingStreamDeltas: agent.disposePendingStreamDeltas,
    setAgentTurnError: (turnError: AgentTurnError): void => {
      agent.flushPendingStreamDeltas()
      const current = agent.getActiveTurn()
      if (current) {
        agent.patchActiveTurn({ ...current, error: turnError })
        return
      }
      const last = session.timeline.value.at(-1)
      if (last?.type === 'agent-turn') {
        updateTimelineTurn(session, { ...last.turn, error: turnError })
      }
    },
    appendLocalTodoUpdate: (todos: TodoItem[]): void => {
      if (todos.length === 0) {
        return
      }
      session.timeline.value = upsertTodoTimelineItem(session.timeline.value, todos)
    },
    ...subagent,
    setPendingQuestion: (question: PendingQuestionState): void => {
      session.pendingQuestion.value = question
    },
    clearPendingQuestion: (): void => {
      session.pendingQuestion.value = null
    },
    submitAnswer: (toolCallId: string, answer: string): void => {
      resolveQuestion(toolCallId, answer)
      if (session.pendingQuestion.value?.toolCallId === toolCallId) {
        session.pendingQuestion.value = null
      }
    },
    hasTimelineContentAfterMessage: (messageId: string): boolean => {
      const index = session.timeline.value.findIndex(
        (entry) => entry.type === 'user' && entry.message.id === messageId,
      )
      return index >= 0 && index < session.timeline.value.length - 1
    },
    beginEditMessage: (messageId: string): void => {
      const message = findUserMessage(messageId)
      if (!message) {
        return
      }
      session.editingMessageId.value = messageId
      session.editDraftText.value = extractUserMessageText(message)
    },
    cancelEditMessage: (): void => {
      session.editingMessageId.value = null
      session.editDraftText.value = ''
    },
    truncateBeforeMessage: async (
      projectSlug: string,
      chatId: string,
      messageId: string,
    ): Promise<void> => {
      await truncateChatLogBeforeMessage(projectSlug, chatId, messageId)
      truncateTimelineBeforeMessage(messageId)
    },
    truncateAfterLastUserMessage: async (
      projectSlug: string,
      chatId: string,
    ): Promise<void> => {
      await truncateChatLogAfterLastUser(projectSlug, chatId)
      truncateTimelineAfterLastUserMessage()
    },
    truncateAfterUserMessage: async (
      projectSlug: string,
      chatId: string,
      messageId: string,
    ): Promise<void> => {
      await truncateChatLogAfterUserMessage(projectSlug, chatId, messageId)
      truncateTimelineAfterUserMessage(messageId)
    },
    getLastUserMessage: (): UIMessage | null => {
      for (let index = session.timeline.value.length - 1; index >= 0; index -= 1) {
        const item = session.timeline.value[index]
        if (item?.type === 'user') {
          return item.message
        }
      }
      return null
    },
    appendLocalCompaction: (summary: string, focus: string | null): void => {
      const closingTurnId = session.activeTurnId.value
      agent.finishAgentTurn()
      session.timeline.value = [
        ...session.timeline.value,
        { type: 'compaction', summary, focus },
      ]
      if (closingTurnId) {
        const nextTurnId = crypto.randomUUID()
        session.turnIdRemap.set(closingTurnId, nextTurnId)
        session.activeTurnId.value = nextTurnId
        session.activeStepId.value = null
        session.pendingStepText.value = ''
      }
    },
    patchMetaActiveContext: (activeContext: {
      checkpointLineId: string
      includeFromCreatedAt: string
      summary: string
    }): void => {
      if (!session.meta.value) {
        return
      }
      session.meta.value = { ...session.meta.value, activeContext }
    },
    activeTurnId: session.activeTurnId,
  }
}

export const bindSessionMutations = (session: ChatSession): SessionMutations => {
  const existing = sessionBindings.get(session)
  if (existing) {
    return existing
  }
  const bound = createSessionMutations(session)
  sessionBindings.set(session, bound)
  return bound
}

export const withActiveSession = <T>(
  fallback: T,
  run: (session: ChatSession, api: SessionMutations) => T,
): T => {
  const session = getActiveSession()
  if (!session) {
    return fallback
  }
  return run(session, bindSessionMutations(session))
}
