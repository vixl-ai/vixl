import type { UIMessage } from 'ai'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type {
  ChatTimelineItem,
  SubagentTimelineItem,
} from '@/types/chat/chat-timeline-item'
import type { TodoItem, HarnessEvent } from '@/types/harness/harness-event'
import type { ToolRun } from '@/types/harness/tool-run'
import closeIncompleteSubagentTools, {
  closeIncompleteSubagentSteps,
} from './close-incomplete-subagent-tools'
import applyHydrateSubagentEvent from './hydrate-apply-subagent-event'
import {
  buildAssistantMessage,
  patchStep,
  upsertToolInStep,
} from './message-parsing'

export type HydrateAccumulator = {
  nextMessages: UIMessage[]
  nextTimeline: ChatTimelineItem[]
  pendingTurn: AgentTurn | null
  currentStepId: string | null
  firstLineCreatedAt: string | null
  pendingSubagents: ChatTimelineItem[]
  timelineSubagentIndex: Map<string, number>
  pendingSubagentIndex: Map<string, number>
  committedTools: Map<string, { itemIndex: number; stepId: string }>
}

type SubagentStartInput = Omit<
  SubagentTimelineItem,
  'type' | 'status' | 'tools' | 'compactions'
> & {
  tools?: SubagentTimelineItem['tools']
  compacting?: boolean
  compactions?: SubagentTimelineItem['compactions']
}

type SubagentList = {
  items: ChatTimelineItem[]
  indexMap: Map<string, number>
}

const createAccumulator = (): HydrateAccumulator => ({
  nextMessages: [],
  nextTimeline: [],
  pendingTurn: null,
  currentStepId: null,
  firstLineCreatedAt: null,
  pendingSubagents: [],
  timelineSubagentIndex: new Map(),
  pendingSubagentIndex: new Map(),
  committedTools: new Map(),
})

const startTarget = (acc: HydrateAccumulator): SubagentList =>
  acc.pendingTurn
    ? { items: acc.pendingSubagents, indexMap: acc.pendingSubagentIndex }
    : { items: acc.nextTimeline, indexMap: acc.timelineSubagentIndex }

const locatedSubagent = (acc: HydrateAccumulator, subagentId: string): SubagentList => {
  if (acc.pendingSubagentIndex.has(subagentId)) {
    return { items: acc.pendingSubagents, indexMap: acc.pendingSubagentIndex }
  }
  return { items: acc.nextTimeline, indexMap: acc.timelineSubagentIndex }
}

const upsertTodo = (acc: HydrateAccumulator, todos: TodoItem[]): void => {
  if (todos.length === 0) {
    return
  }
  const last = acc.nextTimeline.at(-1)
  if (last?.type === 'todo') {
    acc.nextTimeline[acc.nextTimeline.length - 1] = { type: 'todo', todos }
    return
  }
  acc.nextTimeline.push({ type: 'todo', todos })
}

const upsertSubagentStart = (
  items: ChatTimelineItem[],
  indexMap: Map<string, number>,
  subagent: SubagentStartInput,
): void => {
  const index = indexMap.get(subagent.subagentId)
  if (index !== undefined) {
    const existing = items[index]
    if (existing?.type === 'subagent') {
      items[index] = {
        ...existing,
        toolCallId: subagent.toolCallId ?? existing.toolCallId,
        name: subagent.name,
        blocking: subagent.blocking,
        prompt: subagent.prompt ?? existing.prompt,
        model: subagent.model ?? existing.model,
        status: 'running',
        tools: subagent.tools ?? existing.tools,
        steps: subagent.steps ?? existing.steps ?? [],
        compacting: subagent.compacting ?? existing.compacting,
        compactions: subagent.compactions ?? existing.compactions ?? [],
      }
    }
    return
  }
  indexMap.set(subagent.subagentId, items.length)
  items.push({
    type: 'subagent',
    subagentId: subagent.subagentId,
    toolCallId: subagent.toolCallId,
    name: subagent.name,
    blocking: subagent.blocking,
    prompt: subagent.prompt,
    model: subagent.model,
    status: 'running',
    tools: subagent.tools ?? [],
    steps: subagent.steps ?? [],
    compacting: subagent.compacting,
    compactions: subagent.compactions ?? [],
  })
}

const completeSubagentInList = (
  items: ChatTimelineItem[],
  indexMap: Map<string, number>,
  subagentId: string,
  summary: string,
  status: Exclude<SubagentTimelineItem['status'], 'running'>,
  stop?: AgentStop,
): void => {
  const index = indexMap.get(subagentId)
  if (index !== undefined) {
    const existing = items[index]
    if (existing?.type === 'subagent') {
      const resolvedStop = stop ?? existing.stop
      items[index] = {
        ...existing,
        status,
        summary,
        compacting: false,
        compactions: existing.compactions ?? [],
        tools: closeIncompleteSubagentTools(existing.tools),
        steps: closeIncompleteSubagentSteps(existing.steps ?? []),
        ...(resolvedStop ? { stop: resolvedStop } : {}),
      }
    }
    return
  }
  indexMap.set(subagentId, items.length)
  items.push({
    type: 'subagent',
    subagentId,
    name: 'Sub-agent',
    blocking: false,
    status,
    summary,
    tools: [],
    steps: [],
    compacting: false,
    compactions: [],
    ...(stop ? { stop } : {}),
  })
}

const startSubagent = (acc: HydrateAccumulator, subagent: SubagentStartInput): void => {
  const target = startTarget(acc)
  upsertSubagentStart(target.items, target.indexMap, subagent)
}

const completeSubagent = (
  acc: HydrateAccumulator,
  subagentId: string,
  summary: string,
  status: Exclude<SubagentTimelineItem['status'], 'running'>,
  stop?: AgentStop,
): void => {
  const target = locatedSubagent(acc, subagentId)
  completeSubagentInList(
    target.items,
    target.indexMap,
    subagentId,
    summary,
    status,
    stop,
  )
}

const appendSubagentEvent = (
  acc: HydrateAccumulator,
  subagentId: string,
  event: HarnessEvent,
): void => {
  const pendingIndex = acc.pendingSubagentIndex.get(subagentId)
  if (pendingIndex !== undefined) {
    applyHydrateSubagentEvent(acc.pendingSubagents, pendingIndex, event)
    return
  }
  const timelineIndex = acc.timelineSubagentIndex.get(subagentId)
  if (timelineIndex !== undefined) {
    applyHydrateSubagentEvent(acc.nextTimeline, timelineIndex, event)
  }
}

const setSubagentPrompt = (
  acc: HydrateAccumulator,
  subagentId: string,
  prompt: string,
): void => {
  const pendingIndex = acc.pendingSubagentIndex.get(subagentId)
  if (pendingIndex !== undefined) {
    const existing = acc.pendingSubagents[pendingIndex]
    if (existing?.type === 'subagent') {
      acc.pendingSubagents[pendingIndex] = { ...existing, prompt }
    }
    return
  }
  const timelineIndex = acc.timelineSubagentIndex.get(subagentId)
  if (timelineIndex === undefined) {
    return
  }
  const existing = acc.nextTimeline[timelineIndex]
  if (existing?.type === 'subagent') {
    acc.nextTimeline[timelineIndex] = { ...existing, prompt }
  }
}

const upsertCommittedTool = (acc: HydrateAccumulator, run: ToolRun): boolean => {
  const location = acc.committedTools.get(run.toolCallId)
  if (!location) {
    return false
  }
  const item = acc.nextTimeline[location.itemIndex]
  if (item?.type !== 'agent-turn') {
    return false
  }
  const step =
    item.turn.steps.find((candidate) => candidate.id === location.stepId) ??
    item.turn.steps.find((candidate) =>
      candidate.tools.some((tool) => tool.toolCallId === run.toolCallId),
    )
  if (!step) {
    return false
  }
  const updatedTurn = patchStep(item.turn, step.id, upsertToolInStep(step, run))
  acc.nextTimeline[location.itemIndex] = { type: 'agent-turn', turn: updatedTurn }
  const messageIndex = acc.nextMessages.findIndex(
    (message) => message.id === updatedTurn.id,
  )
  if (messageIndex >= 0) {
    acc.nextMessages[messageIndex] = buildAssistantMessage(updatedTurn)
  }
  return true
}

const indexFlushedTurn = (acc: HydrateAccumulator, turn: AgentTurn): void => {
  const itemIndex = acc.nextTimeline.length - 1
  for (const step of turn.steps) {
    for (const tool of step.tools) {
      if (!acc.committedTools.has(tool.toolCallId)) {
        acc.committedTools.set(tool.toolCallId, { itemIndex, stepId: step.id })
      }
    }
  }
}

const mergePendingSubagents = (acc: HydrateAccumulator): void => {
  if (acc.pendingSubagents.length === 0) {
    return
  }
  const offset = acc.nextTimeline.length
  acc.nextTimeline.push(...acc.pendingSubagents)
  for (const [subagentId, pendingIndex] of acc.pendingSubagentIndex) {
    if (!acc.timelineSubagentIndex.has(subagentId)) {
      acc.timelineSubagentIndex.set(subagentId, offset + pendingIndex)
    }
  }
  acc.pendingSubagents = []
  acc.pendingSubagentIndex.clear()
}

const hydrateTimelineBuilder = {
  createAccumulator,
  upsertTodo,
  startSubagent,
  completeSubagent,
  appendSubagentEvent,
  setSubagentPrompt,
  upsertCommittedTool,
  indexFlushedTurn,
  mergePendingSubagents,
}

export default hydrateTimelineBuilder
