import type { UIMessage } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { ToolRun } from '@/types/harness/tool-run'
import { clipTerminalOutput } from '@/utils/clip-terminal-output'
import formatUnknownError from '@/utils/format-unknown-error'
import { isTerminalToolName } from '@/utils/parse-terminal-tool-view'

const RESULT_CHAR_CAP = 8000
const INCOMPLETE_TOOL_MESSAGE = 'Tool did not complete'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const projectToolInput = (args: unknown): Record<string, unknown> =>
  isPlainObject(args) ? args : {}

const serializeProjectedResult = (result: unknown): string => {
  if (typeof result === 'string') {
    return result
  }
  try {
    const json = JSON.stringify(result)
    return typeof json === 'string' ? json : 'null'
  } catch {
    return String(result)
  }
}

const capText = (text: string): string => {
  if (text.length <= RESULT_CHAR_CAP) {
    return text
  }
  const extra = text.length - RESULT_CHAR_CAP
  return `${text.slice(0, RESULT_CHAR_CAP)}... [elided ${extra} chars]`
}

// Terminal output carries the diagnostics in its tail, so it keeps a head and
// tail window instead of the head-only elision other results use.
const capProjectedText = (run: ToolRun, text: string): string =>
  isTerminalToolName(run.name) ? clipTerminalOutput(text) : capText(text)

const capProjectedResult = (run: ToolRun, result: unknown): unknown => {
  const serialized = serializeProjectedResult(result)
  if (serialized.length <= RESULT_CHAR_CAP) {
    return result
  }
  return capProjectedText(run, serialized)
}

const errorTextForRun = (run: ToolRun): string => {
  if (run.status === 'running') {
    return INCOMPLETE_TOOL_MESSAGE
  }
  return capProjectedText(run, formatUnknownError(run.result))
}

const projectToolRun = (run: ToolRun): UIMessage['parts'][number] => {
  if (run.status === 'done') {
    return {
      type: 'dynamic-tool',
      toolName: run.name,
      toolCallId: run.toolCallId,
      state: 'output-available',
      input: projectToolInput(run.args),
      output: capProjectedResult(run, run.result),
    }
  }
  return {
    type: 'dynamic-tool',
    toolName: run.name,
    toolCallId: run.toolCallId,
    state: 'output-error',
    input: projectToolInput(run.args),
    errorText: errorTextForRun(run),
  }
}

export default (step: AgentStep): UIMessage['parts'] => {
  if (step.tools.length === 0) {
    return []
  }
  const parts: UIMessage['parts'] = [{ type: 'step-start' }]
  for (const run of step.tools) {
    parts.push(projectToolRun(run))
  }
  return parts
}
