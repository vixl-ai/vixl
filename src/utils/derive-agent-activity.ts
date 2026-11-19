import type { ChatStatus } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import formatToolRunLabel from '@/utils/format-tool-run-label'

type DeriveAgentActivityArgs = {
  status: ChatStatus
  turn: AgentTurn | null
  runningSubagents: SubagentTimelineItem[]
  hasPendingApproval?: boolean
  hasPendingQuestion?: boolean
  hasPendingMcpAuth?: boolean
  compacting?: boolean
}

const collectRunningTools = (turn: AgentTurn): ToolRun[] => {
  const tools: ToolRun[] = []
  for (const step of turn.steps) {
    for (const tool of step.tools) {
      if (tool.status === 'running') {
        tools.push(tool)
      }
    }
  }
  return tools
}

const hasTurnContent = (turn: AgentTurn): boolean =>
  turn.steps.some(
    (step) =>
      step.reasoning.trim().length > 0 ||
      step.text.trim().length > 0 ||
      step.tools.length > 0,
  ) || turn.text.trim().length > 0

export default (args: DeriveAgentActivityArgs): string | null => {
  if (args.hasPendingApproval) {
    return 'Waiting for approval'
  }
  if (args.hasPendingQuestion) {
    return null
  }
  if (args.hasPendingMcpAuth) {
    return null
  }

  const isLive = args.status === 'streaming' || args.status === 'submitted'
  const runningSubagents = args.runningSubagents.filter(
    (item) => item.status === 'running',
  )

  const runningTools = args.turn ? collectRunningTools(args.turn) : []
  const nonSpawnRunning = runningTools.filter(
    (tool) => tool.name !== 'spawn_subagent',
  )
  const spawnRunning = runningTools.filter(
    (tool) => tool.name === 'spawn_subagent',
  )

  // Tool rows own the live verb once a call exists. Only spawn needs a
  // preamble before the sub-agent card appears.
  if (nonSpawnRunning.length > 0) {
    return null
  }

  if (spawnRunning.length > 0 && runningSubagents.length === 0) {
    return formatToolRunLabel(spawnRunning[spawnRunning.length - 1]!)
  }

  if (!isLive) {
    return null
  }

  // ChatCompactionMarker owns this wait. Gates above still win.
  if (args.compacting) {
    return null
  }

  // submitted and early streaming are one server wait: the run is live, no
  // part has reached the thread yet. running is set before context prep, so
  // this window is real even though it is labelled streaming.
  if (!args.turn || !hasTurnContent(args.turn)) {
    return 'Processing'
  }

  // Turn content exists but no step yet: the text is already on screen, so
  // the output owns the live signal.
  const lastStep = args.turn.steps.at(-1)
  if (!lastStep) {
    return null
  }

  const hasText =
    lastStep.text.trim().length > 0 || args.turn.text.trim().length > 0
  const hasReasoning = lastStep.reasoning.trim().length > 0

  if (lastStep.tools.some((tool) => tool.status === 'running')) {
    return null
  }

  // Tools finished and the model is being called again, including an empty
  // next step after prior content. Same underlying state as submitted.
  // Streaming text or reasoning with no completed-tool wait owns the UI
  // instead.
  if (lastStep.tools.length > 0 || (!hasText && !hasReasoning)) {
    return 'Processing'
  }

  return null
}
