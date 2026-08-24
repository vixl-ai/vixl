import type { UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'

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

  for (const compaction of subagent.compactions) {
    items.push({
      type: 'compaction',
      summary: compaction.summary,
      focus: compaction.focus,
    })
  }

  const turn: AgentTurn = {
    id: `${subagent.subagentId}-turn`,
    text: subagent.summary?.trim() ?? '',
    steps: [
      {
        id: `${subagent.subagentId}-step`,
        text: '',
        reasoning: '',
        tools: subagent.tools,
      },
    ],
  }

  const hasContent =
    turn.text.length > 0 ||
    turn.steps.some((step) => step.tools.length > 0) ||
    subagent.status === 'running'

  if (hasContent) {
    items.push({ type: 'agent-turn', turn })
  }

  return items
}
