import type { AgentStop, AgentStopReason } from '@/types/chat/agent-stop'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HydrateAccumulator } from './hydrate-timeline-builder'

const AGENT_STOP_REASONS: Record<AgentStopReason, true> = {
  completed: true,
  'output-limit': true,
  'content-filter': true,
  'user-stop': true,
  timeout: true,
  error: true,
  failed: true,
  aborted: true,
  compaction: true,
  incomplete: true,
}

const isAgentStopReason = (value: unknown): value is AgentStopReason =>
  typeof value === 'string' && Object.hasOwn(AGENT_STOP_REASONS, value)

export const parseAgentStop = (value: unknown): AgentStop | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as Record<string, unknown>
  if (!isAgentStopReason(record.reason)) {
    return undefined
  }
  if (record.detail !== undefined && typeof record.detail !== 'string') {
    return undefined
  }
  if (record.finish !== undefined && typeof record.finish !== 'string') {
    return undefined
  }
  return {
    reason: record.reason,
    ...(typeof record.detail === 'string' ? { detail: record.detail } : {}),
    ...(typeof record.finish === 'string' ? { finish: record.finish } : {}),
  }
}

const latestCompactionIndex = (timeline: ChatTimelineItem[]): number => {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    if (timeline[index]?.type === 'compaction') {
      return index
    }
  }
  return -1
}

const agentTurnBefore = (timeline: ChatTimelineItem[], index: number): number => {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (timeline[cursor]?.type === 'agent-turn') {
      return cursor
    }
  }
  return -1
}

// Hydrate keys a turn from its first tool until an assistant line rewrites it.
const turnIdIsToolCallId = (turn: AgentTurn): boolean =>
  turn.steps.some((step) => step.tools.some((tool) => tool.toolCallId === turn.id))

const writeTurnStop = (
  acc: HydrateAccumulator,
  index: number,
  stop: AgentStop,
): void => {
  const item = acc.nextTimeline[index]
  if (item?.type !== 'agent-turn') {
    return
  }
  acc.nextTimeline[index] = {
    type: 'agent-turn',
    turn: { ...item.turn, stop },
  }
}

// Returns true when this compaction stop is settled (attached, or kept off a
// turn that already has a stop). False means no closed turn was found.
const attachUnmatchedCompactionStop = (
  acc: HydrateAccumulator,
  stop: AgentStop,
): boolean => {
  if (stop.reason !== 'compaction') {
    return false
  }
  const compactionIndex = latestCompactionIndex(acc.nextTimeline)
  if (compactionIndex < 0) {
    return false
  }
  const turnIndex = agentTurnBefore(acc.nextTimeline, compactionIndex)
  if (turnIndex < 0) {
    return false
  }
  const item = acc.nextTimeline[turnIndex]
  if (item?.type !== 'agent-turn') {
    return false
  }
  if (item.turn.stop != null) {
    return true
  }
  writeTurnStop(acc, turnIndex, stop)
  return true
}

// A non-compaction stop whose id hydrate never wrote can still belong to the
// segment compaction just flushed under a tool id. A newer agent turn owns
// later stops, so leave those to synthesis instead of guessing.
const attachCompactionAdjacentUnmatchedStop = (
  acc: HydrateAccumulator,
  stop: AgentStop,
): boolean => {
  if (stop.reason === 'compaction') {
    return false
  }
  const compactionIndex = latestCompactionIndex(acc.nextTimeline)
  if (compactionIndex < 0) {
    return false
  }
  for (let index = compactionIndex + 1; index < acc.nextTimeline.length; index += 1) {
    if (acc.nextTimeline[index]?.type === 'agent-turn') {
      return false
    }
  }
  const turnIndex = agentTurnBefore(acc.nextTimeline, compactionIndex)
  if (turnIndex < 0) {
    return false
  }
  const item = acc.nextTimeline[turnIndex]
  if (item?.type !== 'agent-turn' || item.turn.stop != null) {
    return false
  }
  if (!turnIdIsToolCallId(item.turn)) {
    return false
  }
  writeTurnStop(acc, turnIndex, stop)
  return true
}

const synthesizeStoppedTurn = (
  acc: HydrateAccumulator,
  turnId: string,
  stop: AgentStop,
): void => {
  acc.nextTimeline.push({
    type: 'agent-turn',
    turn: {
      id: turnId,
      steps: [],
      text: '',
      stop,
    },
  })
}

const attachTurnEnded = (
  acc: HydrateAccumulator,
  harnessEvent: Record<string, unknown>,
): void => {
  const turnId = typeof harnessEvent.turnId === 'string' ? harnessEvent.turnId : ''
  const stop = parseAgentStop(harnessEvent.stop)
  if (!turnId || !stop) {
    return
  }
  // The open turn is often still keyed by its first tool id. A terminal stop
  // is persisted against the live turn id, so claim the open turn before any
  // id scan. Preserve a stop already on it.
  if (acc.pendingTurn) {
    if (acc.pendingTurn.stop == null) {
      acc.pendingTurn = { ...acc.pendingTurn, stop }
    }
    return
  }
  for (let index = acc.nextTimeline.length - 1; index >= 0; index -= 1) {
    const item = acc.nextTimeline[index]
    if (item?.type !== 'agent-turn' || item.turn.id !== turnId) {
      continue
    }
    if (item.turn.stop != null) {
      return
    }
    writeTurnStop(acc, index, stop)
    return
  }
  // Compaction flushes the closed turn under its tool id. The assistant line
  // later rewrites only the continuation, so this stop has no id match yet.
  if (attachUnmatchedCompactionStop(acc, stop)) {
    return
  }
  if (attachCompactionAdjacentUnmatchedStop(acc, stop)) {
    return
  }
  // No flushed turn owns this id. A failure before any tool or assistant
  // line would otherwise disappear on reload.
  synthesizeStoppedTurn(acc, turnId, stop)
}

export default attachTurnEnded
