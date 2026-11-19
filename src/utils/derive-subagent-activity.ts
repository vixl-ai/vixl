import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import formatToolRunLabel from '@/utils/format-tool-run-label'

export default (subagent: SubagentTimelineItem): string | null => {
  if (subagent.status !== 'running') {
    return null
  }

  if (subagent.compacting) {
    return 'Compacting'
  }

  const tools = subagent.tools
  const running = [...tools].reverse().find((tool) => tool.status === 'running')
  if (running) {
    return formatToolRunLabel(running)
  }

  // No tools yet: the card's running dots already show it is live.
  const last = tools.at(-1)
  if (!last) {
    return null
  }
  return formatToolRunLabel(last)
}
