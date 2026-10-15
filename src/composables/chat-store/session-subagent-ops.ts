import type { AgentStop } from '@/types/chat/agent-stop'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { createPendingSubagentStreamDeltaBuffer } from './subagent-stream-delta-buffer'
import {
  appendSubagentToolEvent,
  completeSubagentTimelineItem,
  queueSubagentSteer,
  rollbackQueuedSubagentSteer,
  clearQueuedSubagentSteers,
  setSubagentPrompt,
  upsertSubagentStart,
} from './timeline'
import type { ChatSession, SessionMutations } from './types'

type SubagentStart = {
  subagentId: string
  toolCallId?: string
  name: string
  blocking: boolean
  prompt?: string
  model?: string
}

type SubagentOps = Pick<
  SessionMutations,
  | 'upsertLocalSubagentStart'
  | 'appendLocalSubagentToolEvent'
  | 'queueLocalSubagentSteer'
  | 'rollbackLocalSubagentSteer'
  | 'clearLocalQueuedSubagentSteers'
  | 'setLocalSubagentPrompt'
  | 'completeLocalSubagent'
  | 'getSubagent'
> & {
  disposePendingSubagentStreamDeltas: () => void
}

export default (session: ChatSession): SubagentOps => {
  const pending = createPendingSubagentStreamDeltaBuffer(session, (entry) => {
    session.timeline.value = appendSubagentToolEvent(
      session.timeline.value,
      entry.subagentId,
      entry.kind === 'text'
        ? { type: 'text-delta', delta: entry.text, stepId: entry.stepId }
        : { type: 'reasoning-delta', delta: entry.text, stepId: entry.stepId },
    )
  })

  return {
    upsertLocalSubagentStart: (subagent: SubagentStart): void => {
      session.timeline.value = upsertSubagentStart(session.timeline.value, subagent)
    },
    appendLocalSubagentToolEvent: (
      subagentId: string,
      event: HarnessEvent,
    ): void => {
      if (event.type === 'reasoning-delta') {
        pending.enqueue(subagentId, 'reasoning', event.delta, event.stepId)
        return
      }
      if (event.type === 'text-delta') {
        pending.enqueue(subagentId, 'text', event.delta, event.stepId)
        return
      }
      pending.flushSubagent(subagentId)
      session.timeline.value = appendSubagentToolEvent(
        session.timeline.value,
        subagentId,
        event,
      )
    },
    queueLocalSubagentSteer: (subagentId: string, message: string): void => {
      session.timeline.value = queueSubagentSteer(
        session.timeline.value,
        subagentId,
        message,
      )
    },
    rollbackLocalSubagentSteer: (
      subagentId: string,
      message: string,
      status: SubagentTimelineItem['status'],
    ): void => {
      session.timeline.value = rollbackQueuedSubagentSteer(
        session.timeline.value,
        subagentId,
        message,
        status,
      )
    },
    clearLocalQueuedSubagentSteers: (subagentId: string): void => {
      session.timeline.value = clearQueuedSubagentSteers(
        session.timeline.value,
        subagentId,
      )
    },
    setLocalSubagentPrompt: (subagentId: string, prompt: string): void => {
      session.timeline.value = setSubagentPrompt(session.timeline.value, subagentId, prompt)
    },
    completeLocalSubagent: (
      subagentId: string,
      summary: string,
      status: Exclude<SubagentTimelineItem['status'], 'running'> = 'done',
      stop?: AgentStop,
    ): void => {
      pending.flushSubagent(subagentId)
      session.timeline.value = completeSubagentTimelineItem(
        session.timeline.value,
        subagentId,
        summary,
        status,
        stop,
      )
    },
    getSubagent: (subagentId: string): SubagentTimelineItem | null => {
      const item = session.timeline.value.find(
        (entry) => entry.type === 'subagent' && entry.subagentId === subagentId,
      )
      return item?.type === 'subagent' ? item : null
    },
    disposePendingSubagentStreamDeltas: pending.dispose,
  }
}
