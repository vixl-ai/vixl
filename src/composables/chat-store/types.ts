import type { UIMessage } from 'ai'
import type { ComputedRef, Ref } from 'vue'
import type { AgentTurnError } from '@/types/chat/agent-turn-error'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { ToolRun } from '@/types/harness/tool-run'
import type { TodoItem, HarnessEvent } from '@/types/harness/harness-event'

export type MessagePart = UIMessage['parts'][number]

export type ChatSession = {
  key: string
  projectSlug: string
  chatId: string
  warm: boolean
  meta: Ref<ChatMeta | null>
  messages: Ref<UIMessage[]>
  timeline: Ref<ChatTimelineItem[]>
  loading: Ref<boolean>
  activeTurnId: Ref<string | null>
  activeStepId: Ref<string | null>
  turnIdRemap: Map<string, string>
  pendingStepText: Ref<string>
  pendingQuestion: Ref<PendingQuestionState | null>
  editingMessageId: Ref<string | null>
  editDraftText: Ref<string>
}

export type SessionMutations = {
  meta: ComputedRef<ChatMeta | null>
  messages: ComputedRef<UIMessage[]>
  timeline: ComputedRef<ChatTimelineItem[]>
  pendingQuestion: ComputedRef<PendingQuestionState | null>
  todos: ComputedRef<TodoItem[]>
  activeTurnId: Ref<string | null>
  patchMeta: (patch: Partial<ChatMeta>) => void
  reloadMeta: (projectSlug: string, chatId: string) => Promise<void>
  appendLocalMessage: (message: UIMessage) => void
  startAgentTurn: (turnId: string) => void
  startAgentStep: (stepId: string) => void
  finishAgentStep: () => void
  appendLocalTextDelta: (delta: string, messageId?: string, stepId?: string) => void
  appendLocalReasoningDelta: (delta: string, messageId?: string, stepId?: string) => void
  upsertLocalToolRun: (run: ToolRun) => void
  finishAgentTurn: () => void
  setAgentTurnError: (turnError: AgentTurnError) => void
  appendLocalTodoUpdate: (todos: TodoItem[]) => void
  upsertLocalSubagentStart: (subagent: {
    subagentId: string
    toolCallId?: string
    name: string
    blocking: boolean
    prompt?: string
    model?: string
  }) => void
  appendLocalSubagentToolEvent: (subagentId: string, event: HarnessEvent) => void
  setLocalSubagentPrompt: (subagentId: string, prompt: string) => void
  completeLocalSubagent: (
    subagentId: string,
    summary: string,
    status?: Exclude<SubagentTimelineItem['status'], 'running'>,
  ) => void
  getSubagent: (subagentId: string) => SubagentTimelineItem | null
  setPendingQuestion: (question: PendingQuestionState) => void
  clearPendingQuestion: () => void
  submitAnswer: (toolCallId: string, answer: string) => void
  hasTimelineContentAfterMessage: (messageId: string) => boolean
  beginEditMessage: (messageId: string) => void
  cancelEditMessage: () => void
  truncateBeforeMessage: (
    projectSlug: string,
    chatId: string,
    messageId: string,
  ) => Promise<void>
  truncateAfterLastUserMessage: (projectSlug: string, chatId: string) => Promise<void>
  truncateAfterUserMessage: (
    projectSlug: string,
    chatId: string,
    messageId: string,
  ) => Promise<void>
  getLastUserMessage: () => UIMessage | null
  appendLocalCompaction: (summary: string, focus: string | null) => void
  patchMetaActiveContext: (activeContext: {
    checkpointLineId: string
    includeFromCreatedAt: string
    summary: string
  }) => void
}
