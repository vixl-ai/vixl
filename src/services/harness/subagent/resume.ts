import type { ModelMessage } from 'ai'
import { noPoll, visibleStatus } from '@/services/harness/guidance'
import {
  emitSubagentResult,
  finishSubagentWithError,
} from '@/services/harness/subagent/helpers'
import {
  getSubagent,
  reopen,
  resolve as resolveSubagent,
  setMessages,
} from '@/services/harness/subagent/registry'
import runSubagentGenerate from '@/services/harness/subagent/run-generate'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const resumeSubagent = async (
  ctx: HarnessToolContext,
  subagentId: string,
  message: string,
): Promise<{
  subagentId: string
  name: string
  status: 'running'
  note: string
}> => {
  const record = getSubagent(subagentId)
  if (!record || record.chatId !== ctx.chatId) {
    throw new Error(`Subagent not found: ${subagentId}`)
  }
  const model = record.model
  if (!model) {
    throw new Error(`Subagent has no stored model: ${subagentId}`)
  }

  const controller = new AbortController()
  // Resumed work stays background; do not link to the parent turn signal.
  const reopened = reopen(subagentId, controller)
  if (!reopened) {
    throw new Error(`Subagent cannot be resumed: ${subagentId}`)
  }

  const nextMessages: ModelMessage[] = [
    ...(record.messages ?? []),
    { role: 'user', content: message },
  ]
  setMessages(subagentId, nextMessages)

  ctx.onHarnessEvent?.({
    type: 'subagent-start',
    subagentId,
    toolCallId: record.toolCallId,
    name: record.agentName,
    blocking: false,
    prompt: record.prompt,
    model,
    capabilities: record.capabilities ?? 'read-only',
  })
  ctx.onHarnessEvent?.({
    type: 'subagent-event',
    subagentId,
    parentToolCallId: record.toolCallId,
    event: { type: 'subagent-steer', message },
  })

  const completeSubagent = async (): Promise<void> => {
    try {
      const summary = await runSubagentGenerate({
        ctx,
        subagentId,
        agentName: record.agentName,
        prompt: message,
        toolCallId: record.toolCallId,
        signal: controller.signal,
        model,
        capabilities: record.capabilities ?? 'read-only',
        messages: nextMessages,
      })

      resolveSubagent(subagentId, {
        subagentId,
        name: record.agentName,
        summary,
      })
      emitSubagentResult(ctx, {
        subagentId,
        summary,
        blocking: false,
        outcome: 'completed',
      })
    } catch (error) {
      finishSubagentWithError(ctx, {
        subagentId,
        error,
        blocking: false,
      })
    }
  }

  completeSubagent().catch((error) => {
    finishSubagentWithError(ctx, {
      subagentId,
      error,
      blocking: false,
    })
  })

  return {
    subagentId,
    name: record.agentName,
    status: 'running',
    note: `Resume started in the background. ${noPoll} ${visibleStatus('steered')}`,
  }
}

export default resumeSubagent
