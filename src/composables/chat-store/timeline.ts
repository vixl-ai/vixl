import type { AgentStop } from '@/types/chat/agent-stop'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { TodoItem, HarnessEvent } from '@/types/harness/harness-event'
import applySubagentToolEvent from '@/utils/apply-subagent-tool-event'
import closeIncompleteSubagentTools from './close-incomplete-subagent-tools'

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
        status: 'running',
        tools: subagent.tools ?? existing.tools,
        compacting: subagent.compacting ?? existing.compacting,
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
      compacting: subagent.compacting,
      compactions: subagent.compactions ?? [],
    },
  ]
}

export const completeSubagentTimelineItem = (
  items: ChatTimelineItem[],
  subagentId: string,
  summary: string,
  status: Exclude<SubagentTimelineItem['status'], 'running'> = 'done',
  stop?: AgentStop,
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
        compacting: false,
        compactions: existing.compactions ?? [],
        tools: closeIncompleteSubagentTools(existing.tools),
        ...((existing.stop ?? stop) ? { stop: existing.stop ?? stop } : {}),
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
      compacting: false,
      compactions: [],
      ...(stop ? { stop } : {}),
    },
  ]
}

export const finalizeHydratedSubagents = (
  items: ChatTimelineItem[],
): ChatTimelineItem[] =>
  items.map((item) => {
    if (item.type !== 'subagent' || item.status !== 'running') {
      return item
    }
    return {
      ...item,
      status: 'error',
      compacting: false,
      tools: closeIncompleteSubagentTools(item.tools),
      ...(item.stop ? {} : { stop: { reason: 'incomplete' as const } }),
    }
  })

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
  if (event.type === 'compaction-started') {
    next[index] = {
      ...existing,
      compacting: true,
    }
    return next
  }
  if (event.type === 'compaction-ended') {
    next[index] = {
      ...existing,
      compacting: false,
    }
    return next
  }
  if (event.type === 'compaction') {
    const summary = event.summary
    if (typeof summary === 'string' && summary.length > 0) {
      next[index] = {
        ...existing,
        tools: existing.tools,
        compacting: false,
        compactions: [
          ...(existing.compactions ?? []),
          {
            summary,
            focus: typeof event.focus === 'string' ? event.focus : null,
            toolBoundary: existing.tools.length,
          },
        ],
      }
    }
    return next
  }
  if (event.type === 'subagent-steer') {
    const pending = [...(existing.pendingSteers ?? [])]
    if (pending[0] === event.message) {
      pending.shift()
    }
    next[index] = {
      ...existing,
      status: 'running',
      steers: [
        ...(existing.steers ?? []),
        { message: event.message, toolBoundary: existing.tools.length },
      ],
      pendingSteers: pending,
    }
    return next
  }
  if (event.type === 'subagent-history') {
    next[index] = {
      ...existing,
      messages: event.messages,
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

export const queueSubagentSteer = (
  items: ChatTimelineItem[],
  subagentId: string,
  message: string,
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
    status: 'running',
    pendingSteers: [...(existing.pendingSteers ?? []), message],
  }
  return next
}

export const rollbackQueuedSubagentSteer = (
  items: ChatTimelineItem[],
  subagentId: string,
  message: string,
  status: SubagentTimelineItem['status'],
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
  const pending = [...(existing.pendingSteers ?? [])]
  const lastIndex = pending.lastIndexOf(message)
  if (lastIndex >= 0) {
    pending.splice(lastIndex, 1)
  }
  const next = [...items]
  next[index] = {
    ...existing,
    pendingSteers: pending,
    status: pending.length > 0 ? 'running' : status,
  }
  return next
}

export const clearQueuedSubagentSteers = (
  items: ChatTimelineItem[],
  subagentId: string,
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
  if ((existing.pendingSteers ?? []).length === 0) {
    return items
  }
  const next = [...items]
  next[index] = {
    ...existing,
    pendingSteers: [],
  }
  return next
}
