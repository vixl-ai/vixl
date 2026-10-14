import type { AgentStep } from '@/types/chat/agent-step'
import type { ToolRun } from '@/types/harness/tool-run'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readAssistantParts = (
  content: unknown,
): { reasoning: string; text: string; toolCallIds: string[] } => {
  if (typeof content === 'string') {
    return { reasoning: '', text: content, toolCallIds: [] }
  }
  if (!Array.isArray(content)) {
    return { reasoning: '', text: '', toolCallIds: [] }
  }
  let reasoning = ''
  let text = ''
  const toolCallIds: string[] = []
  for (const raw of content) {
    if (!isRecord(raw)) {
      continue
    }
    if (raw.type === 'reasoning' && typeof raw.text === 'string') {
      reasoning += raw.text
      continue
    }
    if (raw.type === 'text' && typeof raw.text === 'string') {
      text += raw.text
      continue
    }
    if (raw.type === 'tool-call' && typeof raw.toolCallId === 'string') {
      toolCallIds.push(raw.toolCallId)
    }
  }
  return { reasoning, text, toolCallIds }
}

export default (
  subagentId: string,
  messages: unknown[] | undefined,
  tools: ToolRun[],
): AgentStep[] => {
  if (!messages || messages.length === 0 || tools.length === 0) {
    return []
  }

  const used = new Set<string>()
  const steps: AgentStep[] = []
  let foundContent = false

  for (const message of messages) {
    if (!isRecord(message) || message.role !== 'assistant') {
      continue
    }
    const { reasoning, text, toolCallIds } = readAssistantParts(message.content)
    const stepTools = tools.filter((tool) => {
      if (!toolCallIds.includes(tool.toolCallId) || used.has(tool.toolCallId)) {
        return false
      }
      used.add(tool.toolCallId)
      return true
    })
    if (!reasoning && !text && stepTools.length === 0) {
      continue
    }
    if (reasoning.trim().length > 0 || text.trim().length > 0) {
      foundContent = true
    }
    steps.push({
      id: `${subagentId}-step-${steps.length}`,
      text,
      reasoning,
      tools: stepTools,
    })
  }

  if (!foundContent) {
    return []
  }

  const leftover = tools.filter((tool) => !used.has(tool.toolCallId))
  if (leftover.length > 0 && steps.length > 0) {
    const last = steps[steps.length - 1]!
    steps[steps.length - 1] = { ...last, tools: [...last.tools, ...leftover] }
  }

  return steps
}
