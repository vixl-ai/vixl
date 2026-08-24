import type { UIMessage } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import type { HarnessEvent } from '@/types/harness/harness-event'
import mapSubagentResultStatus from '@/utils/map-subagent-result-status'
import { parseChatArtifact, parseChatDiffs, parseTodoItems } from './helpers'
import {
  appendSubagentToolEvent,
  completeSubagentTimelineItem,
  setSubagentPrompt,
  upsertSubagentStart,
  upsertTodoTimelineItem,
} from './timeline'
import {
  closeRunningTools,
  createStep,
  ensureStep,
  getStepIndex,
  patchStep,
  upsertToolInStep,
} from './message-parsing'

export type HydrateAccumulator = {
  nextMessages: UIMessage[]
  nextTimeline: ChatTimelineItem[]
  pendingTurn: AgentTurn | null
  currentStepId: string | null
  pendingSubagents: ChatTimelineItem[]
}

const applyHydrateHarnessEvent = (
  acc: HydrateAccumulator,
  harnessEvent: Record<string, unknown>,
  flushTurn: () => void,
): boolean => {
  const type = harnessEvent.type

  if (type === 'todo-update') {
    const todos = parseTodoItems(harnessEvent.todos)
    if (todos.length > 0) {
      const merged = upsertTodoTimelineItem(acc.nextTimeline, todos)
      acc.nextTimeline.length = 0
      acc.nextTimeline.push(...merged)
    }
    return true
  }

  if (type === 'subagent-start') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const toolCallId =
      typeof harnessEvent.toolCallId === 'string' &&
      harnessEvent.toolCallId.length > 0
        ? harnessEvent.toolCallId
        : undefined
    const name = String(harnessEvent.name ?? 'Sub-agent')
    const blocking = Boolean(harnessEvent.blocking)
    const prompt =
      typeof harnessEvent.prompt === 'string' && harnessEvent.prompt.length > 0
        ? harnessEvent.prompt
        : undefined
    const model =
      typeof harnessEvent.model === 'string' && harnessEvent.model.length > 0
        ? harnessEvent.model
        : undefined
    if (subagentId) {
      const target = acc.pendingTurn ? acc.pendingSubagents : acc.nextTimeline
      const merged = upsertSubagentStart(target, {
        subagentId,
        toolCallId,
        name,
        blocking,
        prompt,
        model,
      })
      if (acc.pendingTurn) {
        acc.pendingSubagents = merged
      } else {
        acc.nextTimeline.length = 0
        acc.nextTimeline.push(...merged)
      }
    }
    return true
  }

  if (type === 'subagent-result') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const summary = String(harnessEvent.summary ?? '')
    const status = mapSubagentResultStatus(harnessEvent.outcome, summary)
    if (subagentId) {
      const inPending = acc.pendingSubagents.some(
        (item) => item.type === 'subagent' && item.subagentId === subagentId,
      )
      if (inPending) {
        acc.pendingSubagents = completeSubagentTimelineItem(
          acc.pendingSubagents,
          subagentId,
          summary,
          status,
        )
      } else {
        const merged = completeSubagentTimelineItem(
          acc.nextTimeline,
          subagentId,
          summary,
          status,
        )
        acc.nextTimeline.length = 0
        acc.nextTimeline.push(...merged)
      }
    }
    return true
  }

  if (type === 'subagent-event') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const nested = harnessEvent.event
    if (
      subagentId &&
      nested &&
      typeof nested === 'object' &&
      'type' in (nested as Record<string, unknown>)
    ) {
      const nestedEvent = nested as HarnessEvent
      const inPending = acc.pendingSubagents.some(
        (item) => item.type === 'subagent' && item.subagentId === subagentId,
      )
      if (inPending) {
        acc.pendingSubagents = appendSubagentToolEvent(
          acc.pendingSubagents,
          subagentId,
          nestedEvent,
        )
      } else {
        const merged = appendSubagentToolEvent(
          acc.nextTimeline,
          subagentId,
          nestedEvent,
        )
        acc.nextTimeline.length = 0
        acc.nextTimeline.push(...merged)
      }
    }
    return true
  }

  if (type === 'pending-subagent') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const prompt = String(harnessEvent.prompt ?? '')
    if (subagentId && prompt) {
      const inPending = acc.pendingSubagents.some(
        (item) => item.type === 'subagent' && item.subagentId === subagentId,
      )
      if (inPending) {
        acc.pendingSubagents = setSubagentPrompt(
          acc.pendingSubagents,
          subagentId,
          prompt,
        )
      } else {
        const merged = setSubagentPrompt(acc.nextTimeline, subagentId, prompt)
        acc.nextTimeline.length = 0
        acc.nextTimeline.push(...merged)
      }
    }
    return true
  }

  if (type === 'compaction') {
    flushTurn()
    const summary = typeof harnessEvent.summary === 'string' ? harnessEvent.summary : ''
    const focus = typeof harnessEvent.focus === 'string' ? harnessEvent.focus : null
    if (summary) {
      acc.nextTimeline.push({ type: 'compaction', summary, focus })
    }
    return true
  }

  if (type === 'step-text') {
    const stepId = String(harnessEvent.stepId ?? '')
    const text = String(harnessEvent.text ?? '')
    if (!stepId || !text || !acc.pendingTurn) {
      return true
    }
    acc.pendingTurn = patchStep(acc.pendingTurn, stepId, {
      text:
        (acc.pendingTurn.steps.find((step) => step.id === stepId)?.text ?? '') +
        text,
    })
    return true
  }

  if (type === 'step-boundary') {
    const stepId = String(harnessEvent.stepId ?? '')
    const action = String(harnessEvent.action ?? '')
    if (!stepId || !acc.pendingTurn) {
      return true
    }
    if (action === 'start') {
      acc.currentStepId = stepId
      acc.pendingTurn = ensureStep(acc.pendingTurn, stepId)
    }
    if (action === 'finish' && acc.currentStepId === stepId) {
      const index = getStepIndex(acc.pendingTurn, stepId)
      if (index >= 0) {
        const steps: AgentStep[] = [...acc.pendingTurn.steps]
        steps[index] = closeRunningTools(steps[index]!)
        acc.pendingTurn = { ...acc.pendingTurn, steps }
      }
    }
    return true
  }

  if (type === 'tool-run') {
    const persistedStatus = harnessEvent.status as ToolRun['status'] | undefined
    const run: ToolRun = {
      toolCallId: String(harnessEvent.toolCallId ?? ''),
      name: String(harnessEvent.name ?? 'tool'),
      status:
        persistedStatus === 'running'
          ? 'error'
          : (persistedStatus ?? 'done'),
      args: harnessEvent.args,
      result:
        harnessEvent.result ??
        (persistedStatus === 'running'
          ? { error: 'Tool did not complete' }
          : undefined),
      artifact: parseChatArtifact(harnessEvent.artifact),
      diffs: parseChatDiffs(harnessEvent.diffs),
    }
    if (!run.toolCallId) {
      return true
    }
    const existingIndex = acc.nextTimeline.findIndex(
      (item) =>
        item.type === 'agent-turn' &&
        item.turn.steps.some((step) =>
          step.tools.some((tool) => tool.toolCallId === run.toolCallId),
        ),
    )
    if (existingIndex >= 0) {
      const item = acc.nextTimeline[existingIndex]
      if (item?.type === 'agent-turn') {
        const turn = item.turn
        const step = turn.steps.find((candidate) =>
          candidate.tools.some((tool) => tool.toolCallId === run.toolCallId),
        )
        if (step) {
          const updatedStep = upsertToolInStep(step, run)
          const updatedTurn = patchStep(turn, step.id, updatedStep)
          const nextTimeline = acc.nextTimeline.map((timelineItem, index) =>
            index === existingIndex
              ? { type: 'agent-turn' as const, turn: updatedTurn }
              : timelineItem,
          )
          acc.nextTimeline.length = 0
          acc.nextTimeline.push(...nextTimeline)
          return true
        }
      }
    }
    if (!acc.pendingTurn) {
      acc.pendingTurn = {
        id: run.toolCallId,
        steps: [],
        text: '',
      }
    }
    if (!acc.currentStepId) {
      acc.currentStepId = 'legacy-step'
      acc.pendingTurn = ensureStep(acc.pendingTurn, acc.currentStepId)
    }
    const stepId =
      typeof harnessEvent.stepId === 'string' && harnessEvent.stepId.length > 0
        ? harnessEvent.stepId
        : acc.currentStepId
    const existingStep =
      acc.pendingTurn.steps.find((step) => step.id === stepId) ??
      createStep(stepId)
    acc.pendingTurn = patchStep(
      acc.pendingTurn,
      stepId,
      upsertToolInStep(existingStep, run),
    )
    return true
  }

  return false
}

export default applyHydrateHarnessEvent
