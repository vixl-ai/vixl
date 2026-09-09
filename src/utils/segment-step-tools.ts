import type { ToolRun } from '@/types/harness/tool-run'

type StepToolSegment = { type: 'tools'; tools: ToolRun[] } | { type: 'subagent'; run: ToolRun }

export default (tools: ToolRun[]): StepToolSegment[] => {
  const segments: StepToolSegment[] = []
  let pending: ToolRun[] = []

  const flushTools = (): void => {
    if (pending.length === 0) {
      return
    }
    segments.push({ type: 'tools', tools: pending })
    pending = []
  }

  for (const tool of tools) {
    if (tool.name === 'spawn_subagent') {
      flushTools()
      segments.push({ type: 'subagent', run: tool })
      continue
    }
    pending.push(tool)
  }
  flushTools()
  return segments
}
