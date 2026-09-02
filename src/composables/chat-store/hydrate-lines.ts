import type { UIMessage } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { AgentTurn } from '@/types/chat/agent-turn'
import { chatMessageLineSchema } from '@/schemas/chat-message-line'
import applyHydrateHarnessEvent, { type HydrateAccumulator } from './hydrate-harness'
import {
  closeRunningTools,
  distributeLegacyStepText,
  extractReasoning,
  extractText,
  getStepIndex,
  parsePart,
  patchStep,
} from './message-parsing'

export type { HydrateAccumulator }

export const createFlushTurn = (acc: HydrateAccumulator): (() => void) => {
  return (): void => {
    if (!acc.pendingTurn) {
      if (acc.pendingSubagents.length > 0) {
        acc.nextTimeline.push(...acc.pendingSubagents)
        acc.pendingSubagents = []
      }
      return
    }
    if (acc.currentStepId) {
      const index = getStepIndex(acc.pendingTurn, acc.currentStepId)
      if (index >= 0) {
        const steps: AgentStep[] = [...acc.pendingTurn.steps]
        steps[index] = closeRunningTools(steps[index]!)
        acc.pendingTurn = { ...acc.pendingTurn, steps }
      }
    }
    const hasContent =
      acc.pendingTurn.text.length > 0 ||
      acc.pendingTurn.steps.some(
        (step) =>
          step.text.length > 0 ||
          step.reasoning.length > 0 ||
          step.tools.length > 0,
      )
    if (hasContent) {
      const normalizedTurn = distributeLegacyStepText(acc.pendingTurn)
      const reasoning = normalizedTurn.steps
        .map((step) => step.reasoning)
        .join('')
      acc.nextTimeline.push({ type: 'agent-turn', turn: normalizedTurn })
      acc.nextMessages.push({
        id: normalizedTurn.id,
        role: 'assistant',
        parts: [
          ...(reasoning
            ? [{ type: 'reasoning' as const, text: reasoning }]
            : []),
          { type: 'text' as const, text: normalizedTurn.text },
        ],
        ...(normalizedTurn.createdAt
          ? { metadata: { createdAt: normalizedTurn.createdAt } }
          : {}),
      })
    }
    if (acc.pendingSubagents.length > 0) {
      acc.nextTimeline.push(...acc.pendingSubagents)
      acc.pendingSubagents = []
    }
    acc.pendingTurn = null
    acc.currentStepId = null
  }
}

export const applyHydrateLine = (
  acc: HydrateAccumulator,
  line: unknown,
  flushTurn: () => void,
): void => {
  const parsed = chatMessageLineSchema.parse(line)
  const harnessEvent = parsed.harnessEvent

  if (harnessEvent && applyHydrateHarnessEvent(acc, harnessEvent, flushTurn)) {
    return
  }

  if (parsed.role === 'user') {
    flushTurn()
    const message: UIMessage = {
      id: parsed.id,
      role: 'user',
      parts: parsed.parts.map(parsePart),
      metadata: {
        createdAt: parsed.createdAt,
        ...(typeof parsed.model === 'string' && parsed.model.length > 0
          ? { model: parsed.model }
          : {}),
        ...(parsed.mentionHighlights && parsed.mentionHighlights.length > 0
          ? { mentionHighlights: parsed.mentionHighlights }
          : {}),
      },
    }
    acc.nextMessages.push(message)
    acc.nextTimeline.push({ type: 'user', message })
    return
  }

  if (parsed.role === 'assistant') {
    const parts = parsed.parts.map(parsePart)
    const reasoning = extractReasoning(parts)
    const text = extractText(parts)
    if (!acc.pendingTurn) {
      acc.pendingTurn = {
        id: parsed.id,
        steps: reasoning
          ? [{ id: parsed.id, text: '', reasoning, tools: [] }]
          : [],
        text,
        createdAt: parsed.createdAt,
      }
    } else {
      let nextTurn: AgentTurn = acc.pendingTurn
      if (reasoning) {
        // Aggregate assistant reasoning is not persisted per-step. Attach it
        // to the earliest step so it renders before tools (e.g. spawn_subagent).
        const stepId = nextTurn.steps[0]?.id ?? acc.currentStepId ?? parsed.id
        nextTurn = patchStep(nextTurn, stepId, {
          reasoning:
            (nextTurn.steps.find((step: AgentStep) => step.id === stepId)
              ?.reasoning ?? '') + reasoning,
        })
      }
      const fromSteps: string = nextTurn.steps
        .map((step: AgentStep) => step.text.trim())
        .filter((value: string) => value.length > 0)
        .join('\n\n')
      // Prefer chronological step text. Only keep assistant-line text on the
      // turn when it is not already restored via step-text events.
      const duplicated =
        Boolean(text) &&
        Boolean(fromSteps) &&
        (text === fromSteps || text.includes(fromSteps) || fromSteps.includes(text))
      acc.pendingTurn = {
        ...nextTurn,
        id: parsed.id,
        text: duplicated ? '' : text || nextTurn.text,
        steps: nextTurn.steps,
        createdAt: nextTurn.createdAt ?? parsed.createdAt,
      }
    }
    flushTurn()
  }
}
