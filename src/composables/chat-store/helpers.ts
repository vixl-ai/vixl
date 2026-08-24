import { ref } from 'vue'
import type { UIMessage } from 'ai'
import type { ChatArtifact } from '@/types/chat/chat-artifact'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { TodoItem } from '@/types/harness/harness-event'
import type { FileDiff } from '@/types/harness/file-diff'
import {
  listPendingQuestionsForChat,
} from '@/services/harness/permission/question-gate'
import { chatMetaSchema } from '@/schemas/chat-meta'
import { fileDiffListSchema } from '@/schemas/file-diff'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import type { ChatSession } from './types'

export const sessions = new Map<string, ChatSession>()
export const activeKey = ref<string | null>(null)

export const makeSessionKey = (projectSlug: string, chatId: string): string =>
  `${projectSlug}::${chatId}`

export const createSession = (projectSlug: string, chatId: string): ChatSession => ({
  key: makeSessionKey(projectSlug, chatId),
  projectSlug,
  chatId,
  warm: false,
  meta: ref<ChatMeta | null>(null),
  messages: ref<UIMessage[]>([]),
  timeline: ref<ChatTimelineItem[]>([]),
  loading: ref(false),
  activeTurnId: ref<string | null>(null),
  activeStepId: ref<string | null>(null),
  pendingStepText: ref(''),
  pendingQuestion: ref<PendingQuestionState | null>(null),
  editingMessageId: ref<string | null>(null),
  editDraftText: ref(''),
})

export const getOrCreateSession = (projectSlug: string, chatId: string): ChatSession => {
  const key = makeSessionKey(projectSlug, chatId)
  const existing = sessions.get(key)
  if (existing) {
    return existing
  }
  const session = createSession(projectSlug, chatId)
  sessions.set(key, session)
  return session
}

export const getActiveSession = (): ChatSession | null => {
  if (!activeKey.value) {
    return null
  }
  return sessions.get(activeKey.value) ?? null
}

export const parseChatArtifact = (value: unknown): ChatArtifact | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const kind = record.kind
  const path = record.path
  if (
    (kind !== 'plan' && kind !== 'studio' && kind !== 'file') ||
    typeof path !== 'string' ||
    path.length === 0
  ) {
    return undefined
  }
  const label = typeof record.label === 'string' ? record.label : undefined
  return { kind, path, label }
}

export const parseChatDiffs = (value: unknown): FileDiff[] | undefined => {
  const parsed = fileDiffListSchema.safeParse(value)
  if (!parsed.success) {
    return undefined
  }
  return parsed.data
}

export const parseTodoItems = (value: unknown): TodoItem[] => {
  if (!Array.isArray(value)) {
    return []
  }
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') {
      return []
    }
    const record = item as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id : ''
    const content = typeof record.content === 'string' ? record.content : ''
    const status = record.status
    if (
      !id ||
      !content ||
      (status !== 'pending' &&
        status !== 'in_progress' &&
        status !== 'completed' &&
        status !== 'cancelled')
    ) {
      return []
    }
    return [{ id, content, status }]
  })
}

export const mapMeta = (record: {
  id: string
  title: string
  projectSlug: string
  projectRoot: string
  mode: string
  model: string
  status: string
  attention?: ChatMeta['attention']
  createdAt: string
  updatedAt: string
  forkedFrom: string | null
  pinned: boolean
  pinnedAt: string | null
  prefixSnapshot?: ChatMeta['prefixSnapshot']
  activeContext?: ChatMeta['activeContext']
  awaitingPlanGo?: ChatMeta['awaitingPlanGo']
  subagentModel?: ChatMeta['subagentModel']
  reasoning?: ChatMeta['reasoning']
  subagentReasoning?: ChatMeta['subagentReasoning']
  usageTotals?: ChatMeta['usageTotals']
}): ChatMeta =>
  chatMetaSchema.parse({
    id: record.id,
    title: record.title,
    projectSlug: record.projectSlug,
    projectRoot: record.projectRoot,
    mode: record.mode,
    model: record.model,
    status: record.status,
    attention: record.attention,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    forkedFrom: record.forkedFrom,
    pinned: record.pinned,
    pinnedAt: record.pinnedAt,
    prefixSnapshot: record.prefixSnapshot,
    activeContext: record.activeContext,
    awaitingPlanGo: record.awaitingPlanGo,
    subagentModel: record.subagentModel,
    reasoning: record.reasoning,
    subagentReasoning: record.subagentReasoning,
    usageTotals: record.usageTotals,
  })

export const clearActiveTurnState = (session: ChatSession): void => {
  session.activeTurnId.value = null
  session.activeStepId.value = null
  session.pendingStepText.value = ''
  session.pendingQuestion.value = null
}

export const extractUserMessageText = (message: UIMessage): string =>
  message.parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')

export const todosFromTimeline = (items: ChatTimelineItem[]): TodoItem[] => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.type === 'todo') {
      return item.todos
    }
  }
  return []
}

export const restorePendingQuestion = (session: ChatSession): void => {
  const pending = listPendingQuestionsForChat(session.chatId)
  const first = pending[0]
  if (!first) {
    session.pendingQuestion.value = null
    return
  }
  session.pendingQuestion.value = {
    toolCallId: first.toolCallId,
    question: first.question,
    options: first.options,
  }
}

export const clearCompletedOrErrorAttention = async (
  session: ChatSession,
): Promise<void> => {
  const attention = session.meta.value?.attention
  if (attention !== 'completed' && attention !== 'error') {
    return
  }
  const record = await updateChatMeta(session.projectSlug, session.chatId, {
    attention: null,
  })
  session.meta.value = mapMeta(record)
}

export const resetChatSessionsForTests = (): void => {
  sessions.clear()
  activeKey.value = null
}
