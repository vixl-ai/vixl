import type { AgentStep } from '@/types/chat/agent-step'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import applySubagentToolEvent from '@/utils/apply-subagent-tool-event'

const TOOL_EVENT_TYPES = new Set([
  'tool-start',
  'tool-result',
  'tool-input-delta',
  'tool-rejected',
])

const lastStepIndex = (steps: AgentStep[]): number => steps.length - 1

const sealedSteps = new WeakSet<AgentStep>()

const markSealed = (step: AgentStep): AgentStep => {
  sealedSteps.add(step)
  return step
}

const indexByStepId = (steps: AgentStep[], stepId: string): number => {
  const match = steps.findIndex((step) => step.id === stepId)
  if (match >= 0) {
    return match
  }
  return lastStepIndex(steps)
}

const emptyStep = (id: string): AgentStep => ({
  id,
  text: '',
  reasoning: '',
  tools: [],
})

const replaceAt = (
  steps: AgentStep[],
  index: number,
  patch: AgentStep,
): AgentStep[] => {
  const previous = steps[index]
  if (previous && sealedSteps.has(previous)) {
    sealedSteps.add(patch)
  }
  const next = [...steps]
  next[index] = patch
  return next
}

const applyToolEventToOpenStep = (
  steps: AgentStep[],
  event: HarnessEvent,
): AgentStep[] => {
  if (steps.length === 0) {
    return steps
  }
  const toolCallId =
    'toolCallId' in event && typeof event.toolCallId === 'string'
      ? event.toolCallId
      : undefined
  let index =
    toolCallId === undefined
      ? -1
      : steps.findIndex((step) =>
          step.tools.some((tool) => tool.toolCallId === toolCallId),
        )
  if (index < 0) {
    index = lastStepIndex(steps)
  }
  const current = steps[index]
  if (!current) {
    return steps
  }
  return replaceAt(steps, index, {
    ...current,
    tools: applySubagentToolEvent(current.tools, event),
  })
}

const toolIdsOf = (steps: AgentStep[]): Set<string> =>
  new Set(steps.flatMap((step) => step.tools.map((tool) => tool.toolCallId)))

const dropUnsealedFromItem = (
  item: SubagentTimelineItem,
  stepIds: string[],
): SubagentTimelineItem => {
  const dropIds = new Set(stepIds)
  const steps = item.steps ?? []
  const keptSteps = steps.filter((step) => !dropIds.has(step.id))
  const keptToolIds = toolIdsOf(keptSteps)
  const exclusiveDropped = new Set<string>()
  for (const id of toolIdsOf(steps.filter((step) => dropIds.has(step.id)))) {
    if (!keptToolIds.has(id)) {
      exclusiveDropped.add(id)
    }
  }
  return {
    ...item,
    steps: keptSteps,
    tools: item.tools.filter((tool) => !exclusiveDropped.has(tool.toolCallId)),
    compactions: item.compactions ?? [],
  }
}

const applySubagentStepEvent = (
  steps: AgentStep[],
  event: HarnessEvent,
): AgentStep[] => {
  if (TOOL_EVENT_TYPES.has(event.type)) {
    return applyToolEventToOpenStep(steps, event)
  }

  if (event.type === 'step-drop-unsealed') {
    if (event.stepIds.length === 0) {
      return steps
    }
    const dropIds = new Set(event.stepIds)
    return steps.filter((step) => !dropIds.has(step.id))
  }

  if (event.type === 'step-start') {
    if (steps.some((step) => step.id === event.stepId)) {
      return steps
    }
    return [...steps, emptyStep(event.stepId)]
  }

  if (event.type === 'step-finish') {
    return steps
  }

  if (event.type === 'reasoning-delta') {
    const index = indexByStepId(steps, event.stepId ?? '')
    const current = steps[index]
    if (!current) {
      return steps
    }
    return replaceAt(steps, index, {
      ...current,
      reasoning: `${current.reasoning}${event.delta}`,
    })
  }

  if (event.type === 'text-delta') {
    const index = indexByStepId(steps, event.stepId ?? '')
    const current = steps[index]
    if (!current) {
      return steps
    }
    return replaceAt(steps, index, {
      ...current,
      text: `${current.text}${event.delta}`,
    })
  }

  if (event.type === 'reasoning-duration') {
    const index = indexByStepId(steps, event.stepId)
    const current = steps[index]
    if (!current) {
      return steps
    }
    return replaceAt(steps, index, {
      ...current,
      reasoningSeconds: event.seconds,
    })
  }

  if (event.type === 'step-content') {
    const match = steps.findIndex((step) => step.id === event.stepId)
    const index = match >= 0 ? match : lastStepIndex(steps)
    const current = steps[index]
    const reasoningSeconds =
      event.reasoningSeconds > 0 ? event.reasoningSeconds : undefined
    if (!current) {
      return [
        markSealed({
          id: event.stepId,
          text: event.text,
          reasoning: event.reasoning,
          ...(reasoningSeconds !== undefined ? { reasoningSeconds } : {}),
          tools: [],
        }),
      ]
    }
    return replaceAt(
      steps,
      index,
      markSealed({
        ...current,
        text: event.text,
        reasoning: event.reasoning,
        reasoningSeconds,
      }),
    )
  }

  return steps
}

const adoptUnclaimedFlatTools = (
  item: SubagentTimelineItem,
): SubagentTimelineItem => {
  const steps = item.steps ?? []
  const index = lastStepIndex(steps)
  const current = steps[index]
  if (!current) {
    return item
  }
  const claimed = toolIdsOf(steps)
  const unclaimed = item.tools.filter((tool) => !claimed.has(tool.toolCallId))
  if (unclaimed.length === 0) {
    return item
  }
  const previous = index > 0 ? steps[index - 1] : undefined
  if (previous && !sealedSteps.has(previous)) {
    return item
  }
  return {
    ...item,
    steps: replaceAt(steps, index, {
      ...current,
      tools: [...current.tools, ...unclaimed],
    }),
  }
}

export const applySubagentItemEvent = (
  item: SubagentTimelineItem,
  event: HarnessEvent,
): SubagentTimelineItem => {
  if (event.type === 'step-drop-unsealed') {
    return dropUnsealedFromItem(item, event.stepIds)
  }
  const next = {
    ...item,
    tools: applySubagentToolEvent(item.tools, event),
    steps: applySubagentStepEvent(item.steps ?? [], event),
    compactions: item.compactions ?? [],
  }
  if (event.type !== 'step-start' && event.type !== 'step-content') {
    return next
  }
  return adoptUnclaimedFlatTools(next)
}

export default applySubagentStepEvent
