import type { AgentStep } from '@/types/chat/agent-step'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ToolRun } from '@/types/harness/tool-run'
import type { ChatSession } from './types'
import {
  closeRunningTools,
  createStep,
  ensureStep,
  getStepIndex,
  patchStep,
  updateAssistantMessage,
  updateTimelineTurn,
  upsertToolInStep,
} from './message-parsing'
import resolveTurnId from './resolve-turn-id'
import { createPendingStreamDeltaBuffer } from './stream-delta-buffer'

type TurnOps = {
  getActiveTurn: () => AgentTurn | null
  patchActiveTurn: (turn: AgentTurn) => void
  startAgentStep: (stepId: string) => void
  finishAgentStep: () => void
  ensureActiveStep: () => string
  appendLocalTextDelta: (delta: string, messageId?: string, stepId?: string) => void
  appendLocalReasoningDelta: (delta: string, messageId?: string, stepId?: string) => void
  setLocalReasoningSeconds: (stepId: string, seconds: number) => void
  upsertLocalToolRun: (run: ToolRun) => void
  closeRunningToolsOnTurn: (turnId: string) => void
  finishAgentTurn: () => void
  flushPendingStreamDeltas: () => void
  disposePendingStreamDeltas: () => void
}

const createSessionAgentOps = (session: ChatSession): TurnOps => {
  const findTurnById = (turnId: string | null): AgentTurn | null => {
    if (!turnId) {
      return null
    }
    const item = session.timeline.value.find(
      (entry) => entry.type === 'agent-turn' && entry.turn.id === turnId,
    )
    return item?.type === 'agent-turn' ? item.turn : null
  }

  const getActiveTurn = (): AgentTurn | null =>
    findTurnById(session.activeTurnId.value)

  const ensureActiveTurn = (): AgentTurn | null => {
    const existing = getActiveTurn()
    if (existing) {
      return existing
    }
    const activeTurnId = session.activeTurnId.value
    if (!activeTurnId) {
      return null
    }
    const turn: AgentTurn = {
      id: activeTurnId,
      steps: [],
      text: '',
      createdAt: new Date().toISOString(),
    }
    session.timeline.value = [...session.timeline.value, { type: 'agent-turn', turn }]
    return turn
  }

  const patchActiveTurn = (turn: AgentTurn): void => {
    updateTimelineTurn(session, turn)
    updateAssistantMessage(session, turn)
  }

  const resolveDeltaTurn = (
    messageId?: string,
  ): { turn: AgentTurn; isActive: boolean } | null => {
    const unresolvedId = messageId ?? session.activeTurnId.value
    if (!unresolvedId) {
      return null
    }
    const turnId = resolveTurnId(unresolvedId, session.turnIdRemap)
    const isActive = turnId === session.activeTurnId.value
    const existing = isActive ? getActiveTurn() : findTurnById(turnId)
    if (existing) {
      return { turn: existing, isActive }
    }
    if (!isActive) {
      return null
    }
    return {
      turn: {
        id: turnId,
        steps: [],
        text: '',
        createdAt: new Date().toISOString(),
      },
      isActive: true,
    }
  }

  const applyLocalTextDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    const resolved = resolveDeltaTurn(messageId)
    if (!resolved) {
      return
    }
    const { turn: current, isActive } = resolved
    const targetStepId = stepId ?? (isActive ? session.activeStepId.value : null)
    if (targetStepId) {
      const step =
        current.steps.find((item) => item.id === targetStepId) ??
        createStep(targetStepId)
      patchActiveTurn(
        patchStep(ensureStep(current, targetStepId), targetStepId, {
          text: step.text + delta,
        }),
      )
      return
    }
    if (isActive) {
      session.pendingStepText.value += delta
      return
    }
    patchActiveTurn({ ...current, text: current.text + delta })
  }

  const applyLocalReasoningDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    const resolved = resolveDeltaTurn(messageId)
    if (!resolved) {
      return
    }
    const { turn: current, isActive } = resolved
    let targetStepId = stepId
    if (!targetStepId) {
      if (isActive) {
        targetStepId = ensureActiveStep()
      } else {
        targetStepId = current.steps.at(-1)?.id ?? crypto.randomUUID()
      }
    } else if (isActive && session.activeStepId.value !== targetStepId) {
      session.activeStepId.value = targetStepId
    }
    const withStep = ensureStep(current, targetStepId)
    const step =
      withStep.steps.find((item) => item.id === targetStepId) ??
      createStep(targetStepId)
    patchActiveTurn(
      patchStep(withStep, targetStepId, {
        reasoning: step.reasoning + delta,
      }),
    )
  }

  const pending = createPendingStreamDeltaBuffer(session, (entry) => {
    if (entry.kind === 'text') {
      applyLocalTextDelta(entry.text, entry.messageId, entry.stepId)
      return
    }
    applyLocalReasoningDelta(entry.text, entry.messageId, entry.stepId)
  })

  const startAgentStep = (stepId: string): void => {
    pending.flush()
    const current = ensureActiveTurn()
    if (!current) {
      return
    }
    if (session.activeStepId.value && session.activeStepId.value !== stepId) {
      const index = getStepIndex(current, session.activeStepId.value)
      if (index >= 0) {
        const steps = [...current.steps]
        steps[index] = closeRunningTools(steps[index]!)
        patchActiveTurn({ ...current, steps })
      }
    }
    session.activeStepId.value = stepId
    const leadingText = session.pendingStepText.value
    session.pendingStepText.value = ''
    const withStep = ensureStep(getActiveTurn() ?? current, stepId)
    if (leadingText) {
      const step =
        withStep.steps.find((item) => item.id === stepId) ?? createStep(stepId)
      patchActiveTurn(
        patchStep(withStep, stepId, {
          text: step.text + leadingText,
        }),
      )
      return
    }
    patchActiveTurn(withStep)
  }

  const finishAgentStep = (): void => {
    pending.flush()
    const current = getActiveTurn()
    if (!current || !session.activeStepId.value) {
      return
    }
    const index = getStepIndex(current, session.activeStepId.value)
    if (index >= 0) {
      const steps = [...current.steps]
      steps[index] = closeRunningTools(steps[index]!)
      patchActiveTurn({ ...current, steps })
    }
    session.activeStepId.value = null
  }

  const ensureActiveStep = (): string => {
    if (session.activeStepId.value) {
      return session.activeStepId.value
    }
    const stepId = crypto.randomUUID()
    startAgentStep(stepId)
    return stepId
  }

  const setLocalReasoningSeconds = (stepId: string, seconds: number): void => {
    pending.flush()
    const current = ensureActiveTurn()
    if (!current) {
      return
    }
    patchActiveTurn(patchStep(current, stepId, { reasoningSeconds: seconds }))
  }

  const findTurnWithTool = (
    toolCallId: string,
  ): { turn: AgentTurn; step: AgentStep } | null => {
    for (const item of session.timeline.value) {
      if (item.type !== 'agent-turn') {
        continue
      }
      for (const step of item.turn.steps) {
        if (step.tools.some((tool) => tool.toolCallId === toolCallId)) {
          return { turn: item.turn, step }
        }
      }
    }
    return null
  }

  const upsertLocalToolRun = (run: ToolRun): void => {
    pending.flush()
    const existing = findTurnWithTool(run.toolCallId)
    if (existing && existing.turn.id !== session.activeTurnId.value) {
      const updatedStep = upsertToolInStep(existing.step, run)
      const updatedTurn = patchStep(existing.turn, existing.step.id, updatedStep)
      updateTimelineTurn(session, updatedTurn)
      updateAssistantMessage(session, updatedTurn)
      return
    }
    const current = ensureActiveTurn()
    if (!current) {
      return
    }
    const stepId = ensureActiveStep()
    const step =
      current.steps.find((item) => item.id === stepId) ?? createStep(stepId)
    patchActiveTurn(patchStep(current, stepId, upsertToolInStep(step, run)))
  }

  const closeRunningToolsOnTurn = (turnId: string): void => {
    const current = findTurnById(turnId)
    if (!current) {
      return
    }
    patchActiveTurn({
      ...current,
      steps: current.steps.map((step) => closeRunningTools(step)),
    })
  }

  const finishAgentTurn = (): void => {
    pending.flush()
    finishAgentStep()
    const current = getActiveTurn()
    if (current) {
      const trailingText = session.pendingStepText.value.trim()
      session.pendingStepText.value = ''
      patchActiveTurn({
        ...current,
        // Keep step.text so the UI can render chronological step order
        // (text before later tools). Only store out-of-step trailing text here.
        text: trailingText ? `${current.text}${trailingText}` : current.text,
        steps: current.steps.map((step) => closeRunningTools(step)),
      })
    } else {
      session.pendingStepText.value = ''
    }
    session.activeTurnId.value = null
    session.activeStepId.value = null
  }

  return {
    getActiveTurn,
    patchActiveTurn,
    startAgentStep,
    finishAgentStep,
    ensureActiveStep,
    appendLocalTextDelta: (delta, messageId, stepId) => {
      pending.enqueue('text', delta, messageId, stepId)
    },
    appendLocalReasoningDelta: (delta, messageId, stepId) => {
      pending.enqueue('reasoning', delta, messageId, stepId)
    },
    setLocalReasoningSeconds,
    upsertLocalToolRun,
    closeRunningToolsOnTurn,
    finishAgentTurn,
    flushPendingStreamDeltas: pending.flush,
    disposePendingStreamDeltas: pending.dispose,
  }
}

export default createSessionAgentOps
