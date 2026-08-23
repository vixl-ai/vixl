import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import mapSubagentResultStatus from '@/utils/map-subagent-result-status'

export default (
  run: ToolRun,
  byToolCallId: Map<string, SubagentTimelineItem>,
  bySubagentId: Map<string, SubagentTimelineItem>,
): SubagentTimelineItem => {
  const fromToolCall = byToolCallId.get(run.toolCallId)
  if (fromToolCall) {
    return fromToolCall
  }

  const result =
    run.result && typeof run.result === 'object'
      ? (run.result as Record<string, unknown>)
      : null
  const subagentId = typeof result?.subagentId === 'string' ? result.subagentId : ''
  if (subagentId) {
    const fromId = bySubagentId.get(subagentId)
    if (fromId) {
      return fromId
    }
  }

  const args =
    run.args && typeof run.args === 'object'
      ? (run.args as Record<string, unknown>)
      : null
  const name =
    (typeof result?.name === 'string' && result.name) ||
    (typeof args?.agentName === 'string' && args.agentName) ||
    'Sub-agent'
  const summary = typeof result?.summary === 'string' ? result.summary : undefined
  const blocking = typeof args?.blocking === 'boolean' ? args.blocking : true
  const status: SubagentTimelineItem['status'] =
    run.status === 'running' || result?.status === 'running'
      ? 'running'
      : run.status === 'error' || run.status === 'rejected'
        ? 'error'
        : mapSubagentResultStatus(undefined, summary)

  return {
    type: 'subagent',
    subagentId: subagentId || run.toolCallId,
    toolCallId: run.toolCallId,
    name,
    blocking,
    status,
    summary,
    tools: [],
    compactions: [],
  }
}
