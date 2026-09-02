import type { ToolRun } from '@/types/harness/tool-run'
import type { HarnessEvent } from '@/types/harness/harness-event'
import mergeToolRunArgs from '@/utils/merge-tool-run-args'
import toolArgsPath from '@/utils/tool-args-path'

const HOLD_PATH_TOOLS = new Set(['write_file', 'edit_file'])

export default (tools: ToolRun[], event: HarnessEvent): ToolRun[] => {
  if (event.type === 'tool-input-delta') {
    const existing = tools.find((item) => item.toolCallId === event.toolCallId)
    const name = event.name || existing?.name || 'tool'
    const args = mergeToolRunArgs(existing?.args, event.args)
    if (HOLD_PATH_TOOLS.has(name) && !toolArgsPath(args)) {
      return tools
    }
    if (existing && existing.status !== 'running') {
      return tools
    }
    const run: ToolRun = {
      toolCallId: event.toolCallId,
      name,
      status: 'running',
      args,
    }
    return [...tools.filter((item) => item.toolCallId !== event.toolCallId), run]
  }

  if (event.type === 'tool-start') {
    const existing = tools.find((item) => item.toolCallId === event.toolCallId)
    const run: ToolRun = {
      toolCallId: event.toolCallId,
      name: event.name,
      status: 'running',
      args: mergeToolRunArgs(existing?.args, event.args),
    }
    return [...tools.filter((item) => item.toolCallId !== event.toolCallId), run]
  }

  if (event.type === 'tool-result') {
    const existing = tools.find((item) => item.toolCallId === event.toolCallId)
    const run: ToolRun = {
      toolCallId: event.toolCallId,
      name: existing?.name ?? 'tool',
      status: event.isError ? 'error' : 'done',
      args: existing?.args,
      result: event.result,
      artifact: event.artifact ?? existing?.artifact,
      diffs: event.diffs ?? existing?.diffs,
    }
    if (!existing) {
      return [...tools, run]
    }
    return tools.map((item) => (item.toolCallId === event.toolCallId ? run : item))
  }

  if (event.type === 'tool-rejected') {
    return tools.map((item) =>
      item.toolCallId === event.toolCallId
        ? { ...item, status: 'rejected', result: { error: event.reason } }
        : item,
    )
  }

  return tools
}
