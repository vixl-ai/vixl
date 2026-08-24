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

type TurnOps = {
  getActiveTurn: () => AgentTurn | null
  patchActiveTurn: (turn: AgentTurn) => void
  startAgentStep: (stepId: string) => void
  finishAgentStep: () => void
  ensureActiveStep: () => string
  appendLocalTextDelta: (delta: string, messageId?: string, stepId?: string) => void
  appendLocalReasoningDelta: (delta: string, messageId?: string, stepId?: string) => void
  upsertLocalToolRun: (run: ToolRun) => void
  finishAgentTurn: () => void
}

const createSessionAgentOps = (session: ChatSession): TurnOps => {
  const getActiveTurn = (): AgentTurn | null => {
    if (!session.activeTurnId.value) {
      return null
    }
    const item = session.timeline.value.find(
      (entry) =>
        entry.type === 'agent-turn' && entry.turn.id === session.activeTurnId.value,
    )
    return item?.type === 'agent-turn' ? item.turn : null
  }

  const patchActiveTurn = (turn: AgentTurn): void => {
    updateTimelineTurn(session, turn)
    updateAssistantMessage(session, turn)
  }

  const startAgentStep = (stepId: string): void => {
    const current = getActiveTurn()
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

  const appendLocalTextDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    const turnId = messageId ?? session.activeTurnId.value
    if (!turnId) {
      return
    }
    if (turnId !== session.activeTurnId.value) {
      session.activeTurnId.value = turnId
    }
    const current =
      getActiveTurn() ??
      ({
        id: turnId,
        steps: [],
        text: '',
      } satisfies AgentTurn)

    const targetStepId = stepId ?? session.activeStepId.value
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

    session.pendingStepText.value += delta
  }

  const appendLocalReasoningDelta = (
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    const turnId = messageId ?? session.activeTurnId.value
    if (!turnId) {
      return
    }
    if (turnId !== session.activeTurnId.value) {
      session.activeTurnId.value = turnId
    }
    const targetStepId = stepId ?? ensureActiveStep()
    if (stepId && session.activeStepId.value !== stepId) {
      session.activeStepId.value = stepId
    }
    const current =
      getActiveTurn() ??
      ({
        id: turnId,
        steps: [],
        text: '',
      } satisfies AgentTurn)
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
    const existing = findTurnWithTool(run.toolCallId)
    if (existing && existing.turn.id !== session.activeTurnId.value) {
      const updatedStep = upsertToolInStep(existing.step, run)
      const updatedTurn = patchStep(existing.turn, existing.step.id, updatedStep)
      updateTimelineTurn(session, updatedTurn)
      return
    }
    const current = getActiveTurn()
    if (!current) {
      return
    }
    const stepId = ensureActiveStep()
    const step =
      current.steps.find((item) => item.id === stepId) ?? createStep(stepId)
    patchActiveTurn(patchStep(current, stepId, upsertToolInStep(step, run)))
  }

  const finishAgentTurn = (): void => {
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
    appendLocalTextDelta,
    appendLocalReasoningDelta,
    upsertLocalToolRun,
    finishAgentTurn,
  }
}

export default createSessionAgentOps
