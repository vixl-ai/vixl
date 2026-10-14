import type { AgentStep } from '@/types/chat/agent-step'
import type { ToolRun } from '@/types/harness/tool-run'

const closeIncompleteSubagentTools = (tools: ToolRun[]): ToolRun[] =>
  tools.map((tool) =>
    tool.status === 'running'
      ? {
          ...tool,
          status: 'error' as const,
          result: { error: 'Tool did not complete' },
        }
      : tool,
  )

export const closeIncompleteSubagentSteps = (steps: AgentStep[]): AgentStep[] =>
  steps.map((step) => ({
    ...step,
    tools: closeIncompleteSubagentTools(step.tools),
  }))

export default closeIncompleteSubagentTools
