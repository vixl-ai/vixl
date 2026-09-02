import type { ChatArtifact } from '@/types/chat/chat-artifact'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessEvent, TodoItem } from '@/types/harness/harness-event'
import { appendChatLine } from '@/services/vixl/vixl-tauri'
import { nowIso } from './helpers'

export const persistLine = async (
  projectSlug: string,
  chatId: string,
  line: Record<string, unknown>,
): Promise<void> => {
  await appendChatLine(projectSlug, chatId, line)
}

export const persistToolRun = async (
  projectSlug: string,
  chatId: string,
  toolCallId: string,
  name: string,
  status: 'running' | 'done' | 'error' | 'rejected',
  stepId: string,
  args?: unknown,
  result?: unknown,
  artifact?: ChatArtifact,
  diffs?: FileDiff[],
): Promise<void> => {
  await persistLine(projectSlug, chatId, {
    id: toolCallId,
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: {
      type: 'tool-run',
      toolCallId,
      name,
      status,
      stepId,
      args,
      result,
      ...(artifact ? { artifact } : {}),
      ...(diffs ? { diffs } : {}),
    },
  })
}

export const persistStepBoundary = async (
  projectSlug: string,
  chatId: string,
  stepId: string,
  action: 'start' | 'finish',
): Promise<void> => {
  await persistLine(projectSlug, chatId, {
    id: stepId,
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: {
      type: 'step-boundary',
      stepId,
      action,
    },
  })
}

export const persistTodoUpdate = async (
  projectSlug: string,
  chatId: string,
  todos: TodoItem[],
): Promise<void> => {
  await persistLine(projectSlug, chatId, {
    id: crypto.randomUUID(),
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: {
      type: 'todo-update',
      todos,
    },
  })
}

export const persistSubagentHarnessEvent = async (
  projectSlug: string,
  chatId: string,
  event:
    | Extract<HarnessEvent, { type: 'subagent-start' }>
    | Extract<HarnessEvent, { type: 'subagent-result' }>
    | Extract<HarnessEvent, { type: 'subagent-event' }>,
): Promise<void> => {
  if (
    event.type === 'subagent-event' &&
    (event.event.type === 'compaction-started' ||
      event.event.type === 'compaction-ended')
  ) {
    return
  }
  const lineId =
    event.type === 'subagent-start'
      ? event.subagentId
      : event.type === 'subagent-result'
        ? `${event.subagentId}-result`
        : `${event.subagentId}-event-${crypto.randomUUID()}`
  await persistLine(projectSlug, chatId, {
    id: lineId,
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: event,
  })
}

export const persistPendingSubagent = async (
  projectSlug: string,
  chatId: string,
  event: Extract<HarnessEvent, { type: 'pending-subagent' }>,
): Promise<void> => {
  await persistLine(projectSlug, chatId, {
    id: `${event.subagentId}-pending`,
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: event,
  })
}

export const persistStepText = async (
  projectSlug: string,
  chatId: string,
  stepId: string,
  text: string,
): Promise<void> => {
  if (!text.trim()) {
    return
  }
  await persistLine(projectSlug, chatId, {
    id: `${stepId}-text`,
    role: 'assistant',
    parts: [],
    createdAt: nowIso(),
    harnessEvent: {
      type: 'step-text',
      stepId,
      text,
    },
  })
}
