import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { applySubagentItemEvent } from '@/utils/apply-subagent-step-event'

const applyHydrateSubagentEvent = (
  items: ChatTimelineItem[],
  index: number,
  event: HarnessEvent,
): void => {
  const existing = items[index]
  if (existing?.type !== 'subagent') {
    return
  }
  if (event.type === 'compaction-started') {
    items[index] = {
      ...existing,
      compacting: true,
    }
    return
  }
  if (event.type === 'compaction-ended') {
    items[index] = {
      ...existing,
      compacting: false,
    }
    return
  }
  if (event.type === 'compaction') {
    const summary = event.summary
    if (typeof summary === 'string' && summary.length > 0) {
      items[index] = {
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
    return
  }
  if (event.type === 'subagent-steer') {
    const pending = [...(existing.pendingSteers ?? [])]
    if (pending[0] === event.message) {
      pending.shift()
    }
    items[index] = {
      ...existing,
      status: 'running',
      steers: [
        ...(existing.steers ?? []),
        { message: event.message, toolBoundary: existing.tools.length },
      ],
      pendingSteers: pending,
    }
    return
  }
  if (event.type === 'subagent-history') {
    items[index] = {
      ...existing,
      messages: event.messages,
    }
    return
  }
  items[index] = applySubagentItemEvent(existing, event)
}

export default applyHydrateSubagentEvent
