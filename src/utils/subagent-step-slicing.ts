import type { AgentStep } from '@/types/chat/agent-step'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'

export type TimelineBoundary =
  | {
      kind: 'compaction'
      toolBoundary: number
      summary: string
      focus: string | null
    }
  | {
      kind: 'steer'
      toolBoundary: number
      message: string
      steerIndex: number
    }

type IndexedStep = {
  step: AgentStep
  start: number
  end: number
}

export const collectBoundaries = (
  subagent: SubagentTimelineItem,
): TimelineBoundary[] => {
  const boundaries: TimelineBoundary[] = [
    ...subagent.compactions.map(
      (compaction): TimelineBoundary => ({
        kind: 'compaction',
        toolBoundary: compaction.toolBoundary,
        summary: compaction.summary,
        focus: compaction.focus,
      }),
    ),
    ...(subagent.steers ?? []).flatMap((steer, steerIndex): TimelineBoundary[] => {
      const message = steer.message.trim()
      if (!message) {
        return []
      }
      return [
        {
          kind: 'steer',
          toolBoundary: steer.toolBoundary,
          message,
          steerIndex,
        },
      ]
    }),
  ]
  const kindRank = (kind: TimelineBoundary['kind']): number =>
    kind === 'steer' ? 0 : 1
  return boundaries.sort((left, right) => {
    const boundaryDiff = left.toolBoundary - right.toolBoundary
    if (boundaryDiff !== 0) {
      return boundaryDiff
    }
    return kindRank(left.kind) - kindRank(right.kind)
  })
}

export const indexSteps = (steps: AgentStep[]): IndexedStep[] => {
  let offset = 0
  return steps.map((step) => {
    const start = offset
    const end = offset + step.tools.length
    offset = end
    return { step, start, end }
  })
}

const sliceStepForRange = (
  indexed: IndexedStep,
  from: number,
  to: number,
  isTrailing: boolean,
): AgentStep | null => {
  const { step, start, end } = indexed
  if (start === end) {
    const include =
      start >= from && (start < to || (isTrailing && start === to))
    return include ? step : null
  }
  const overlapFrom = Math.max(start, from)
  const overlapTo = Math.min(end, to)
  if (overlapFrom >= overlapTo) {
    return null
  }
  const keepContent = start >= from
  const tools = step.tools.slice(overlapFrom - start, overlapTo - start)
  if (overlapFrom === start && overlapTo === end) {
    return step
  }
  return {
    id: keepContent ? step.id : `${step.id}-rest-${overlapFrom}`,
    text: keepContent ? step.text : '',
    reasoning: keepContent ? step.reasoning : '',
    ...(keepContent && step.reasoningSeconds !== undefined
      ? { reasoningSeconds: step.reasoningSeconds }
      : {}),
    tools,
  }
}

export const stepsForToolRange = (
  indexed: IndexedStep[],
  from: number,
  to: number,
  isTrailing: boolean,
): AgentStep[] => {
  const sliced: AgentStep[] = []
  for (const item of indexed) {
    const next = sliceStepForRange(item, from, to, isTrailing)
    if (next) {
      sliced.push(next)
    }
  }
  return sliced
}
