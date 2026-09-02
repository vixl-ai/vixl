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
  if (tools.length === 0) {
    return 'Working'
  }

  const running = [...tools].reverse().find((tool) => tool.status === 'running')
  if (running) {
    return formatToolRunLabel(running)
  }

  const last = tools.at(-1)
  if (!last) {
    return 'Working'
  }
  return formatToolRunLabel(last)
}
