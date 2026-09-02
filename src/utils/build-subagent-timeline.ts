import type { UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'

const buildTurn = (
  subagent: SubagentTimelineItem,
  turnIndex: number,
  tools: ToolRun[],
  text: string,
): AgentTurn => {
  const segmented = subagent.compactions.length > 0
  return {
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
  }
}

const turnHasContent = (
  turn: AgentTurn,
  includeRunning: boolean,
  status: SubagentTimelineItem['status'],
): boolean =>
  turn.text.length > 0 ||
  turn.steps.some((step) => step.tools.length > 0) ||
  (includeRunning && status === 'running')

export default (subagent: SubagentTimelineItem): ChatTimelineItem[] => {
  const items: ChatTimelineItem[] = []

  if (subagent.prompt?.trim()) {
    const message: UIMessage = {
      id: `${subagent.subagentId}-prompt`,
      role: 'user',
      parts: [{ type: 'text', text: subagent.prompt.trim() }],
      metadata: subagent.model ? { model: subagent.model } : undefined,
    }
    items.push({ type: 'user', message })
  }

  if (subagent.compactions.length === 0) {
    const turn = buildTurn(subagent, 0, subagent.tools, subagent.summary?.trim() ?? '')
    if (turnHasContent(turn, true, subagent.status)) {
      items.push({ type: 'agent-turn', turn })
    }
    return items
  }

  let previousBoundary = 0
  let turnIndex = 0

  for (const compaction of subagent.compactions) {
    const tools = subagent.tools.slice(previousBoundary, compaction.toolBoundary)
    if (tools.length > 0) {
      items.push({
        type: 'agent-turn',
        turn: buildTurn(subagent, turnIndex, tools, ''),
      })
      turnIndex += 1
    }
    items.push({
      type: 'compaction',
      summary: compaction.summary,
      focus: compaction.focus,
    })
    previousBoundary = compaction.toolBoundary
  }

  const trailing = buildTurn(
    subagent,
    turnIndex,
    subagent.tools.slice(previousBoundary),
    subagent.summary?.trim() ?? '',
  )
  if (turnHasContent(trailing, true, subagent.status)) {
    items.push({ type: 'agent-turn', turn: trailing })
  }

  return items
}
