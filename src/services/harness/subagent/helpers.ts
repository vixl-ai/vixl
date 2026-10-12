import {
  abortOne as abortSubagent,
  fail as failSubagent,
  getSubagent,
} from '@/services/harness/subagent/registry'
import type { AgentStop } from '@/types/chat/agent-stop'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export const sanitizeSubagentName = (name: string): string => {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.slice(0, 64) || 'subagent'
}

export const subagentStopForFinish = (
  finishReason: string | undefined,
): AgentStop => {
  if (finishReason === 'length') {
    return { reason: 'output-limit', finish: 'length' }
  }
  if (finishReason === 'content-filter') {
    return { reason: 'content-filter', finish: 'content-filter' }
  }
  if (finishReason) {
    return { reason: 'completed', finish: finishReason }
  }
  return { reason: 'completed' }
}

export const emitSubagentResult = (
  ctx: HarnessToolContext,
  args: {
    subagentId: string
    summary: string
    blocking: boolean
    outcome: 'completed' | 'failed' | 'aborted'
    stop?: AgentStop
  },
): void => {
  ctx.onHarnessEvent?.({
    type: 'subagent-result',
    subagentId: args.subagentId,
    summary: args.summary,
    blocking: args.blocking,
    outcome: args.outcome,
    ...(args.stop ? { stop: args.stop } : {}),
  })
}

export const finishSubagentWithError = (
  ctx: HarnessToolContext,
  args: {
    subagentId: string
    error: unknown
    blocking: boolean
    aborted: boolean
  },
): void => {
  const message = args.error instanceof Error ? args.error.message : 'Subagent failed'
  const record = getSubagent(args.subagentId)
  const aborted = record?.status === 'aborted' || args.aborted

  if (aborted) {
    if (record?.status === 'running') {
      abortSubagent(args.subagentId)
    }
    const stopped = getSubagent(args.subagentId)
    emitSubagentResult(ctx, {
      subagentId: args.subagentId,
      summary: stopped?.result?.summary ?? 'Stopped',
      blocking: args.blocking,
      outcome: 'aborted',
      stop: { reason: 'aborted' },
    })
    return
  }

  failSubagent(args.subagentId, message)
  emitSubagentResult(ctx, {
    subagentId: args.subagentId,
    summary: message,
    blocking: args.blocking,
    outcome: 'failed',
    stop: { reason: 'failed', detail: message },
  })
}
