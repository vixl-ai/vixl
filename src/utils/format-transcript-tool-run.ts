import type { ToolRun } from '@/types/harness/tool-run'
import { clipTerminalOutput } from '@/utils/clip-terminal-output'
import formatUnknownError from '@/utils/format-unknown-error'

const summarizeArgs = (args: unknown): string | null => {
  if (args === undefined) {
    return null
  }
  try {
    const raw = JSON.stringify(args)
    if (!raw || raw === '{}' || raw === 'null') {
      return null
    }
    return raw
  } catch {
    return null
  }
}

export default (run: ToolRun): string => {
  const segments = [`TOOL ${run.name} [${run.status}]`]
  const args = summarizeArgs(run.args)
  if (args) {
    segments.push(args)
  }
  if (run.status === 'error') {
    segments.push(clipTerminalOutput(formatUnknownError(run.result)))
  }
  return segments.join(' ')
}
