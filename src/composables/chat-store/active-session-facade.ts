import type { UIMessage } from 'ai'
import type { AgentTurnError } from '@/types/chat/agent-turn-error'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { TodoItem, HarnessEvent } from '@/types/harness/harness-event'
import type { ToolRun } from '@/types/harness/tool-run'
import { resolveQuestion } from '@/services/harness/permission/question-gate'
import { getActiveSession } from './helpers'
import { bindSessionMutations, withActiveSession } from './session-mutations'

const createActiveSessionFacade = () => {
  const patchMeta = (patch: Partial<ChatMeta>): void => {
    withActiveSession(undefined, (_session, api) => {
      api.patchMeta(patch)
    })
  }

  const reloadMeta = async (projectSlug: string, chatIdValue: string): Promise<void> => {
    const session = getActiveSession()
    if (!session) {
      return
    }
    await bindSessionMutations(session).reloadMeta(projectSlug, chatIdValue)
  }

  const appendLocalMessage = (message: UIMessage): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalMessage(message)
    })
  }

  const startAgentTurn = (turnId: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.startAgentTurn(turnId)
    })
  }

  const startAgentStep = (stepId: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.startAgentStep(stepId)
    })
  }

  const finishAgentStep = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.finishAgentStep()
    })
  }

  const appendLocalTextDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalTextDelta(delta, messageId, stepId)
    })
  }

  const appendLocalReasoningDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalReasoningDelta(delta, messageId, stepId)
    })
  }

  const upsertLocalToolRun = (run: ToolRun): void => {
    withActiveSession(undefined, (_session, api) => {
      api.upsertLocalToolRun(run)
    })
  }

  const finishAgentTurn = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.finishAgentTurn()
    })
  }

  const flushPendingStreamDeltas = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.flushPendingStreamDeltas()
    })
  }

  const disposePendingStreamDeltas = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.disposePendingStreamDeltas()
    })
  }

  const setAgentTurnError = (turnError: AgentTurnError): void => {
    withActiveSession(undefined, (_session, api) => {
      api.setAgentTurnError(turnError)
    })
  }

  const appendLocalTodoUpdate = (todosValue: TodoItem[]): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalTodoUpdate(todosValue)
    })
  }

  const upsertLocalSubagentStart = (subagent: {
    subagentId: string
    toolCallId?: string
    name: string
    blocking: boolean
    prompt?: string
    model?: string
  }): void => {
    withActiveSession(undefined, (_session, api) => {
      api.upsertLocalSubagentStart(subagent)
    })
  }

  const appendLocalSubagentToolEvent = (
    subagentId: string,
    event: HarnessEvent,
  ): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalSubagentToolEvent(subagentId, event)
    })
  }

  const queueLocalSubagentSteer = (subagentId: string, message: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.queueLocalSubagentSteer(subagentId, message)
    })
  }

  const rollbackLocalSubagentSteer = (
    subagentId: string,
    message: string,
    status: SubagentTimelineItem['status'],
  ): void => {
    withActiveSession(undefined, (_session, api) => {
      api.rollbackLocalSubagentSteer(subagentId, message, status)
    })
  }

  const clearLocalQueuedSubagentSteers = (subagentId: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.clearLocalQueuedSubagentSteers(subagentId)
    })
  }

  const setLocalSubagentPrompt = (subagentId: string, prompt: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.setLocalSubagentPrompt(subagentId, prompt)
    })
  }

  const completeLocalSubagent = (
    subagentId: string,
    summary: string,
    status?: Exclude<SubagentTimelineItem['status'], 'running'>,
  ): void => {
    withActiveSession(undefined, (_session, api) => {
      api.completeLocalSubagent(subagentId, summary, status)
    })
  }

  const getSubagent = (subagentId: string): SubagentTimelineItem | null =>
    withActiveSession(null, (_session, api) => api.getSubagent(subagentId))

  const setPendingQuestion = (question: PendingQuestionState): void => {
    withActiveSession(undefined, (_session, api) => {
      api.setPendingQuestion(question)
    })
  }

  const clearPendingQuestion = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.clearPendingQuestion()
    })
  }

  const submitAnswer = (toolCallId: string, answer: string): void => {
    resolveQuestion(toolCallId, answer)
    const session = getActiveSession()
    if (session?.pendingQuestion.value?.toolCallId === toolCallId) {
      session.pendingQuestion.value = null
    }
  }

  const hasTimelineContentAfterMessage = (messageId: string): boolean =>
    withActiveSession(false, (_session, api) =>
      api.hasTimelineContentAfterMessage(messageId),
    )

  const beginEditMessage = (messageId: string): void => {
    withActiveSession(undefined, (_session, api) => {
      api.beginEditMessage(messageId)
    })
  }

  const cancelEditMessage = (): void => {
    withActiveSession(undefined, (_session, api) => {
      api.cancelEditMessage()
    })
  }

  const truncateBeforeMessage = async (
    projectSlug: string,
    chatIdValue: string,
    messageId: string,
  ): Promise<void> => {
    const session = getActiveSession()
    if (!session) {
      return
    }
    await bindSessionMutations(session).truncateBeforeMessage(
      projectSlug,
      chatIdValue,
      messageId,
    )
  }

  const truncateAfterLastUserMessage = async (
    projectSlug: string,
    chatIdValue: string,
  ): Promise<void> => {
    const session = getActiveSession()
    if (!session) {
      return
    }
    await bindSessionMutations(session).truncateAfterLastUserMessage(
      projectSlug,
      chatIdValue,
    )
  }

  const truncateAfterUserMessage = async (
    projectSlug: string,
    chatIdValue: string,
    messageId: string,
  ): Promise<void> => {
    const session = getActiveSession()
    if (!session) {
      return
    }
    await bindSessionMutations(session).truncateAfterUserMessage(
      projectSlug,
      chatIdValue,
      messageId,
    )
  }

  const getLastUserMessage = (): UIMessage | null =>
    withActiveSession(null, (_session, api) => api.getLastUserMessage())

  const appendLocalCompaction = (summary: string, focus: string | null): void => {
    withActiveSession(undefined, (_session, api) => {
      api.appendLocalCompaction(summary, focus)
    })
  }

  const patchMetaActiveContext = (activeContext: {
    checkpointLineId: string
    includeFromCreatedAt: string
    summary: string
  }): void => {
    withActiveSession(undefined, (_session, api) => {
      api.patchMetaActiveContext(activeContext)
    })
  }

  return {
    patchMeta,
    reloadMeta,
    appendLocalMessage,
    startAgentTurn,
    startAgentStep,
    finishAgentStep,
    appendLocalTextDelta,
    appendLocalReasoningDelta,
    upsertLocalToolRun,
    finishAgentTurn,
    flushPendingStreamDeltas,
    disposePendingStreamDeltas,
    setAgentTurnError,
    appendLocalTodoUpdate,
    upsertLocalSubagentStart,
    appendLocalSubagentToolEvent,
    queueLocalSubagentSteer,
    rollbackLocalSubagentSteer,
    clearLocalQueuedSubagentSteers,
    setLocalSubagentPrompt,
    completeLocalSubagent,
    getSubagent,
    setPendingQuestion,
    clearPendingQuestion,
    submitAnswer,
    hasTimelineContentAfterMessage,
    beginEditMessage,
    cancelEditMessage,
    truncateBeforeMessage,
    truncateAfterLastUserMessage,
    truncateAfterUserMessage,
    getLastUserMessage,
    appendLocalCompaction,
    patchMetaActiveContext,
  }
}

export default createActiveSessionFacade
