import type { UIMessage } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import backfillSubagentStepsFromHistory from '@/utils/backfill-subagent-steps-from-history'
import {
  collectBoundaries,
  indexSteps,
  stepsForToolRange,
} from '@/utils/subagent-step-slicing'
import type { TimelineBoundary } from '@/utils/subagent-step-slicing'
import trailingSubagentSummary from '@/utils/trailing-subagent-summary'

const userItem = (
  id: string,
  text: string,
  model?: string,
): ChatTimelineItem => {
  const message: UIMessage = {
    id,
    role: 'user',
    parts: [{ type: 'text', text }],
    metadata: model ? { model } : undefined,
  }
  return { type: 'user', message }
}

const resolveSteps = (subagent: SubagentTimelineItem): AgentStep[] => {
  const stored = subagent.steps ?? []
  if (stored.length > 0) {
    return stored
  }
  const finished =
    subagent.status === 'done' ||
    subagent.status === 'stopped' ||
    subagent.status === 'error'
  if (!finished || subagent.tools.length === 0) {
    return []
  }
  return backfillSubagentStepsFromHistory(
    subagent.subagentId,
    subagent.messages,
    subagent.tools,
  )
}

const buildLegacyTurn = (
  subagent: SubagentTimelineItem,
  turnIndex: number,
  tools: ToolRun[],
  text: string,
  segmented: boolean,
): AgentTurn => ({
  id: segmented
    ? `${subagent.subagentId}-turn-${turnIndex}`
    : `${subagent.subagentId}-turn`,
  text,
  steps: [
    {
      id: segmented
        ? `${subagent.subagentId}-step-${turnIndex}`
        : `${subagent.subagentId}-step`,
      text: '',
      reasoning: '',
      tools,
    },
  ],
})

const buildTurnFromSteps = (
  subagent: SubagentTimelineItem,
  turnIndex: number,
  steps: AgentStep[],
  text: string,
  segmented: boolean,
): AgentTurn => ({
  id: segmented
    ? `${subagent.subagentId}-turn-${turnIndex}`
    : `${subagent.subagentId}-turn`,
  text,
  steps,
})

const turnHasContent = (
  turn: AgentTurn,
  includeRunning: boolean,
  status: SubagentTimelineItem['status'],
): boolean =>
  turn.text.length > 0 ||
  turn.steps.some(
    (step) =>
      step.tools.length > 0 ||
      step.text.length > 0 ||
      step.reasoning.length > 0,
  ) ||
  (includeRunning && status === 'running')

const appendPendingSteerMessages = (
  items: ChatTimelineItem[],
  subagent: SubagentTimelineItem,
): void => {
  const deliveredCount = (subagent.steers ?? []).length
  for (const [offset, text] of (subagent.pendingSteers ?? []).entries()) {
    const trimmed = text.trim()
    if (!trimmed) {
      continue
    }
    items.push(
      userItem(
        `${subagent.subagentId}-steer-${deliveredCount + offset}`,
        trimmed,
        subagent.model,
      ),
    )
  }
}

const pushBoundaryItem = (
  items: ChatTimelineItem[],
  subagent: SubagentTimelineItem,
  boundary: TimelineBoundary,
): void => {
  if (boundary.kind === 'compaction') {
    items.push({
      type: 'compaction',
      summary: boundary.summary,
      focus: boundary.focus,
    })
    return
  }
  items.push(
    userItem(
      `${subagent.subagentId}-steer-${boundary.steerIndex}`,
      boundary.message,
      subagent.model,
    ),
  )
}

const pushTurnIfContent = (
  items: ChatTimelineItem[],
  turn: AgentTurn,
  subagent: SubagentTimelineItem,
): void => {
  if (turnHasContent(turn, true, subagent.status)) {
    items.push({ type: 'agent-turn', turn })
  }
}

const buildLegacyTimeline = (
  items: ChatTimelineItem[],
  subagent: SubagentTimelineItem,
  boundaries: TimelineBoundary[],
): ChatTimelineItem[] => {
  const segmented = boundaries.length > 0
  if (!segmented) {
    const turn = buildLegacyTurn(
      subagent,
      0,
      subagent.tools,
      subagent.summary?.trim() ?? '',
      false,
    )
    pushTurnIfContent(items, turn, subagent)
    appendPendingSteerMessages(items, subagent)
    return items
  }

  let previousBoundary = 0
  let turnIndex = 0

  for (const boundary of boundaries) {
    const tools = subagent.tools.slice(previousBoundary, boundary.toolBoundary)
    if (tools.length > 0) {
      items.push({
        type: 'agent-turn',
        turn: buildLegacyTurn(subagent, turnIndex, tools, '', true),
      })
      turnIndex += 1
    }
    pushBoundaryItem(items, subagent, boundary)
    previousBoundary = boundary.toolBoundary
  }

  const trailing = buildLegacyTurn(
    subagent,
    turnIndex,
    subagent.tools.slice(previousBoundary),
    subagent.summary?.trim() ?? '',
    true,
  )
  pushTurnIfContent(items, trailing, subagent)
  appendPendingSteerMessages(items, subagent)
  return items
}

const buildSteppedTimeline = (
  items: ChatTimelineItem[],
  subagent: SubagentTimelineItem,
  steps: AgentStep[],
  boundaries: TimelineBoundary[],
): ChatTimelineItem[] => {
  const summaryText = trailingSubagentSummary(subagent.summary, steps)
  const segmented = boundaries.length > 0
  if (!segmented) {
    const turn = buildTurnFromSteps(subagent, 0, steps, summaryText, false)
    pushTurnIfContent(items, turn, subagent)
    appendPendingSteerMessages(items, subagent)
    return items
  }

  const indexed = indexSteps(steps)
  let previousBoundary = 0
  let turnIndex = 0

  for (const boundary of boundaries) {
    const sliced = stepsForToolRange(
      indexed,
      previousBoundary,
      boundary.toolBoundary,
      false,
    )
    if (sliced.length > 0) {
      const turn = buildTurnFromSteps(subagent, turnIndex, sliced, '', true)
      pushTurnIfContent(items, turn, subagent)
      turnIndex += 1
    }
    pushBoundaryItem(items, subagent, boundary)
    previousBoundary = boundary.toolBoundary
  }

  const trailingSteps = stepsForToolRange(
    indexed,
    previousBoundary,
    subagent.tools.length,
    true,
  )
  const trailing = buildTurnFromSteps(
    subagent,
    turnIndex,
    trailingSteps,
    summaryText,
    true,
  )
  pushTurnIfContent(items, trailing, subagent)
  appendPendingSteerMessages(items, subagent)
  return items
}

export default (subagent: SubagentTimelineItem): ChatTimelineItem[] => {
  const items: ChatTimelineItem[] = []

  if (subagent.prompt?.trim()) {
    items.push(
      userItem(
        `${subagent.subagentId}-prompt`,
        subagent.prompt.trim(),
        subagent.model,
      ),
    )
  }

  const boundaries = collectBoundaries(subagent)
  const steps = resolveSteps(subagent)
  if (steps.length === 0) {
    return buildLegacyTimeline(items, subagent, boundaries)
  }
  return buildSteppedTimeline(items, subagent, steps, boundaries)
}
