import type { AgentStop } from '@/types/chat/agent-stop'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
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

export default (session: ChatSession): Pick<
  SessionMutations,
  | 'upsertLocalSubagentStart'
  | 'appendLocalSubagentToolEvent'
  | 'queueLocalSubagentSteer'
  | 'rollbackLocalSubagentSteer'
  | 'clearLocalQueuedSubagentSteers'
  | 'setLocalSubagentPrompt'
  | 'completeLocalSubagent'
  | 'getSubagent'
> => ({
  upsertLocalSubagentStart: (subagent: SubagentStart): void => {
    session.timeline.value = upsertSubagentStart(session.timeline.value, subagent)
  },
  appendLocalSubagentToolEvent: (
    subagentId: string,
    event: HarnessEvent,
  ): void => {
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
})
