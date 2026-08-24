import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { TodoItem, HarnessEvent } from '@/types/harness/harness-event'
import applySubagentToolEvent from '@/utils/apply-subagent-tool-event'

export const upsertTodoTimelineItem = (
  items: ChatTimelineItem[],
  todos: TodoItem[],
): ChatTimelineItem[] => {
  if (todos.length === 0) {
    return items
  }
  const next = [...items]
  const last = next.at(-1)
  if (last?.type === 'todo') {
    next[next.length - 1] = { type: 'todo', todos }
    return next
  }
  return [...next, { type: 'todo', todos }]
}

export const upsertSubagentStart = (
  items: ChatTimelineItem[],
  subagent: Omit<SubagentTimelineItem, 'type' | 'status' | 'tools' | 'compactions'> & {
    tools?: SubagentTimelineItem['tools']
    compactions?: SubagentTimelineItem['compactions']
  },
): ChatTimelineItem[] => {
  const index = items.findIndex(
    (item) => item.type === 'subagent' && item.subagentId === subagent.subagentId,
  )
  if (index >= 0) {
    const next = [...items]
    const existing = next[index]
    if (existing?.type === 'subagent') {
      next[index] = {
        ...existing,
        toolCallId: subagent.toolCallId ?? existing.toolCallId,
        name: subagent.name,
        blocking: subagent.blocking,
        prompt: subagent.prompt ?? existing.prompt,
        model: subagent.model ?? existing.model,
        tools: subagent.tools ?? existing.tools,
        compactions: subagent.compactions ?? existing.compactions ?? [],
      }
    }
    return next
  }
  return [
    ...items,
    {
      type: 'subagent',
      subagentId: subagent.subagentId,
      toolCallId: subagent.toolCallId,
      name: subagent.name,
      blocking: subagent.blocking,
      prompt: subagent.prompt,
      model: subagent.model,
      status: 'running',
      tools: subagent.tools ?? [],
      compactions: subagent.compactions ?? [],
    },
  ]
}

export const completeSubagentTimelineItem = (
  items: ChatTimelineItem[],
  subagentId: string,
  summary: string,
  status: Exclude<SubagentTimelineItem['status'], 'running'> = 'done',
): ChatTimelineItem[] => {
  const index = items.findIndex(
    (item) => item.type === 'subagent' && item.subagentId === subagentId,
  )
  if (index >= 0) {
    const next = [...items]
    const existing = next[index]
    if (existing?.type === 'subagent') {
      next[index] = {
        ...existing,
        status,
        summary,
        compactions: existing.compactions ?? [],
      }
    }
    return next
  }
  return [
    ...items,
    {
      type: 'subagent',
      subagentId,
      name: 'Sub-agent',
      blocking: false,
      status,
      summary,
      tools: [],
      compactions: [],
    },
  ]
}

export const appendSubagentToolEvent = (
  items: ChatTimelineItem[],
  subagentId: string,
  event: HarnessEvent,
): ChatTimelineItem[] => {
  const index = items.findIndex(
    (item) => item.type === 'subagent' && item.subagentId === subagentId,
  )
  if (index < 0) {
    return items
  }
  const existing = items[index]
  if (existing?.type !== 'subagent') {
    return items
  }
  const next = [...items]
  if (event.type === 'compaction') {
    const summary = event.summary
    if (typeof summary === 'string' && summary.length > 0) {
      next[index] = {
        ...existing,
        tools: existing.tools,
        compactions: [
          ...(existing.compactions ?? []),
          {
            summary,
            focus: typeof event.focus === 'string' ? event.focus : null,
          },
        ],
      }
    }
    return next
  }
  next[index] = {
    ...existing,
    tools: applySubagentToolEvent(existing.tools, event),
    compactions: existing.compactions ?? [],
  }
  return next
}

export const setSubagentPrompt = (
  items: ChatTimelineItem[],
  subagentId: string,
  prompt: string,
): ChatTimelineItem[] => {
  const index = items.findIndex(
    (item) => item.type === 'subagent' && item.subagentId === subagentId,
  )
  if (index < 0) {
    return items
  }
  const existing = items[index]
  if (existing?.type !== 'subagent') {
    return items
  }
  const next = [...items]
  next[index] = {
    ...existing,
    prompt,
  }
  return next
}
