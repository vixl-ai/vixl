import type { UIMessage } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import toolRunToUiParts from '@/utils/tool-run-to-ui-parts'
import type { ChatSession, MessagePart } from './types'

const parsePositiveSeconds = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

export const parsePart = (part: Record<string, unknown>): MessagePart => {
  if (part.type === 'reasoning' && typeof part.text === 'string') {
    const duration = parsePositiveSeconds(part.duration)
    return {
      type: 'reasoning',
      text: part.text,
      ...(duration !== undefined ? { duration } : {}),
    } as MessagePart
  }
  if (
    part.type === 'file' &&
    typeof part.url === 'string' &&
    typeof part.mediaType === 'string'
  ) {
    return {
      type: 'file',
      url: part.url,
      mediaType: part.mediaType,
      ...(typeof part.filename === 'string' ? { filename: part.filename } : {}),
    }
  }
  if (typeof part.text === 'string') {
    return { type: 'text', text: part.text }
  }
  return { type: 'text', text: '' }
}

export const extractReasoning = (parts: MessagePart[]): string =>
  parts
    .filter((part) => part.type === 'reasoning')
    .map((part) => (part.type === 'reasoning' ? part.text : ''))
    .join('')

export const extractReasoningDuration = (parts: MessagePart[]): number | undefined => {
  let sum = 0
  let found = false
  for (const part of parts) {
    if (part.type !== 'reasoning') {
      continue
    }
    const duration = parsePositiveSeconds(
      'duration' in part ? (part as { duration?: unknown }).duration : undefined,
    )
    if (duration === undefined) {
      continue
    }
    sum += duration
    found = true
  }
  return found ? sum : undefined
}

export const extractText = (parts: MessagePart[]): string =>
  parts
    .filter((part) => part.type === 'text')
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')

export const createStep = (id: string, text = ''): AgentStep => ({
  id,
  text,
  reasoning: '',
  tools: [],
})

export const upsertToolInStep = (step: AgentStep, run: ToolRun): AgentStep => {
  const tools = [...step.tools]
  const index = tools.findIndex((item) => item.toolCallId === run.toolCallId)
  if (index >= 0) {
    const existing = tools[index]!
    const status =
      (existing.status === 'done' || existing.status === 'error') &&
      run.status === 'running'
        ? existing.status
        : run.status
    tools[index] = {
      ...existing,
      ...run,
      status,
      args: run.args ?? existing.args,
      result: run.result ?? existing.result,
      artifact: run.artifact ?? existing.artifact,
      diffs: run.diffs ?? existing.diffs,
    }
  } else {
    tools.push(run)
  }
  return { ...step, tools }
}

export const closeRunningTools = (step: AgentStep): AgentStep => ({
  ...step,
  tools: step.tools.map((tool) =>
    tool.status === 'running'
      ? {
          ...tool,
          status: 'done' as const,
          result: tool.result ?? { stopped: true },
        }
      : tool,
  ),
})

export const updateTimelineTurn = (session: ChatSession, turn: AgentTurn): void => {
  const items = [...session.timeline.value]
  const index = items.findIndex(
    (item) => item.type === 'agent-turn' && item.turn.id === turn.id,
  )
  if (index >= 0) {
    items[index] = { type: 'agent-turn', turn }
    session.timeline.value = items
    return
  }
  session.timeline.value = [...items, { type: 'agent-turn', turn }]
}

const assistantTextFromTurn = (turn: AgentTurn): string =>
  turn.text.trim() ||
  turn.steps
    .map((step) => step.text.trim())
    .filter((value) => value.length > 0)
    .join('\n\n')

const assistantPartsFromTurn = (turn: AgentTurn): MessagePart[] => {
  const parts: MessagePart[] = []
  for (const step of turn.steps) {
    if (step.reasoning) {
      parts.push({ type: 'reasoning', text: step.reasoning })
    }
    if (step.text.trim()) {
      parts.push({ type: 'text', text: step.text })
    }
    parts.push(...toolRunToUiParts(step))
  }
  if (turn.text.trim()) {
    parts.push({ type: 'text', text: turn.text })
  }
  return parts
}

export const buildAssistantMessage = (turn: AgentTurn): UIMessage => ({
  id: turn.id,
  role: 'assistant',
  parts: assistantPartsFromTurn(turn),
  ...(turn.createdAt ? { metadata: { createdAt: turn.createdAt } } : {}),
})

export const updateAssistantMessage = (session: ChatSession, turn: AgentTurn): void => {
  const reasoning = turn.steps.map((step) => step.reasoning).join('')
  const text = assistantTextFromTurn(turn)
  const hasTools = turn.steps.some((step) => step.tools.length > 0)
  if (!reasoning && !text && !hasTools) {
    return
  }
  const message = buildAssistantMessage(turn)
  const index = session.messages.value.findIndex((item) => item.id === turn.id)
  if (index >= 0) {
    session.messages.value = session.messages.value.map((item, itemIndex) =>
      itemIndex === index ? message : item,
    )
    return
  }
  session.messages.value = [...session.messages.value, message]
}

export const getStepIndex = (turn: AgentTurn, stepId: string): number =>
  turn.steps.findIndex((step) => step.id === stepId)

export const ensureStep = (turn: AgentTurn, stepId: string): AgentTurn => {
  if (getStepIndex(turn, stepId) >= 0) {
    return turn
  }
  return { ...turn, steps: [...turn.steps, createStep(stepId)] }
}

export const patchStep = (
  turn: AgentTurn,
  stepId: string,
  patch: Partial<AgentStep>,
): AgentTurn => {
  const next = ensureStep(turn, stepId)
  const index = getStepIndex(next, stepId)
  if (index < 0) {
    return next
  }
  const steps = [...next.steps]
  steps[index] = { ...steps[index]!, ...patch }
  return { ...next, steps }
}

export const distributeLegacyStepText = (turn: AgentTurn): AgentTurn => {
  const paragraphs = turn.text
    .split(/\n\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  if (paragraphs.length === 0 || turn.steps.some((step) => step.text.trim().length > 0)) {
    return turn
  }

  const toolStepIndexes = turn.steps
    .map((step, index) => (step.tools.length > 0 ? index : -1))
    .filter((index) => index >= 0)
  const assignCount = Math.min(paragraphs.length, toolStepIndexes.length)
  if (assignCount === 0) {
    return turn
  }

  const startAt = toolStepIndexes.length - assignCount
  const steps = [...turn.steps]
  for (let index = 0; index < assignCount; index += 1) {
    const stepIndex = toolStepIndexes[startAt + index]!
    steps[stepIndex] = {
      ...steps[stepIndex]!,
      text: paragraphs[index]!,
    }
  }

  return {
    ...turn,
    steps,
    text: paragraphs.slice(assignCount).join('\n\n'),
  }
}

export const rebuildMessagesFromTimeline = (items: ChatTimelineItem[]): UIMessage[] => {
  const nextMessages: UIMessage[] = []
  for (const item of items) {
    if (item.type === 'user') {
      nextMessages.push(item.message)
      continue
    }
    if (item.type !== 'agent-turn') {
      continue
    }
    nextMessages.push(buildAssistantMessage(item.turn))
  }
  return nextMessages
}
