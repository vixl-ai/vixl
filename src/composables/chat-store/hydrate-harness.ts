import type { AgentStep } from '@/types/chat/agent-step'
import type { ToolRun } from '@/types/harness/tool-run'
import type { HarnessEvent } from '@/types/harness/harness-event'
import mapSubagentResultStatus from '@/utils/map-subagent-result-status'
import attachTurnEnded, { parseAgentStop } from './attach-turn-ended'
import { parseChatArtifact, parseChatDiffs, parseTodoItems } from './helpers'
import hydrateTimelineBuilder, {
  type HydrateAccumulator,
} from './hydrate-timeline-builder'
import {
  closeRunningTools,
  createStep,
  ensureStep,
  getStepIndex,
  patchStep,
  upsertToolInStep,
} from './message-parsing'

export type { HydrateAccumulator }

const applyHydrateHarnessEvent = (
  acc: HydrateAccumulator,
  harnessEvent: Record<string, unknown>,
  flushTurn: () => void,
  createdAt?: string,
): boolean => {
  const type = harnessEvent.type
  const isParentTurnPrefixLine =
    type === 'step-boundary' || type === 'step-text'
  const canStampPendingTurn =
    isParentTurnPrefixLine || type === 'tool-run'

  if (
    !acc.pendingTurn &&
    createdAt &&
    !acc.firstLineCreatedAt &&
    isParentTurnPrefixLine
  ) {
    acc.firstLineCreatedAt = createdAt
  }
  if (acc.pendingTurn && !acc.pendingTurn.createdAt && canStampPendingTurn) {
    const stamp = acc.firstLineCreatedAt ?? createdAt
    if (stamp) {
      acc.pendingTurn = { ...acc.pendingTurn, createdAt: stamp }
    }
  }

  if (type === 'turn-ended') {
    attachTurnEnded(acc, harnessEvent)
    return true
  }

  if (type === 'todo-update') {
    const todos = parseTodoItems(harnessEvent.todos)
    if (todos.length > 0) {
      hydrateTimelineBuilder.upsertTodo(acc, todos)
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
      hydrateTimelineBuilder.startSubagent(acc, {
        subagentId,
        toolCallId,
        name,
        blocking,
        prompt,
        model,
      })
    }
    return true
  }

  if (type === 'subagent-result') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const summary = String(harnessEvent.summary ?? '')
    const status = mapSubagentResultStatus(harnessEvent.outcome, summary)
    if (subagentId) {
      hydrateTimelineBuilder.completeSubagent(
        acc,
        subagentId,
        summary,
        status,
        parseAgentStop(harnessEvent.stop),
      )
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
      hydrateTimelineBuilder.appendSubagentEvent(
        acc,
        subagentId,
        nested as HarnessEvent,
      )
    }
    return true
  }

  if (type === 'pending-subagent') {
    const subagentId = String(harnessEvent.subagentId ?? '')
    const prompt = String(harnessEvent.prompt ?? '')
    if (subagentId && prompt) {
      hydrateTimelineBuilder.setSubagentPrompt(acc, subagentId, prompt)
    }
    return true
  }

  if (type === 'compaction-started' || type === 'compaction-ended') {
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
    if (hydrateTimelineBuilder.upsertCommittedTool(acc, run)) {
      return true
    }
    if (!acc.pendingTurn) {
      const stamp = acc.firstLineCreatedAt ?? createdAt
      acc.pendingTurn = {
        id: run.toolCallId,
        steps: [],
        text: '',
        ...(stamp ? { createdAt: stamp } : {}),
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
