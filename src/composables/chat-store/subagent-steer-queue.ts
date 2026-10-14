import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'

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
