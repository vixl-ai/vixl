import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { SubagentEntry } from '@/types/harness/subagent-entry'
import type { ToolRun } from '@/types/harness/tool-run'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mapMetaStatusToChatStatus } from '@/services/harness/orchestrator'
import mapSubagentResultStatus from '@/utils/map-subagent-result-status'
import type { AgentHarnessState, AttentionHelpers } from './types'

type EventDeps = {
  startMcpAuthPolling: () => void
  syncPendingMcpAuth: () => void
  maybeFlushBackgroundSubagentResume: () => void
}

export default (
  state: AgentHarnessState,
  attention: AttentionHelpers,
  deps: EventDeps,
) => {
  const {
    options,
    session,
    status,
    toolRuns,
    subagents,
    liveEvents,
    pendingApprovals,
    billableUsageRecords,
    turnUsageByTurnId,
    contextUsage,
    contextBudgetSync,
  } = state

  const handleEvent = (event: HarnessEvent): void => {
    liveEvents.value = [...liveEvents.value, event]
    if (event.type === 'text-delta') {
      session.appendLocalTextDelta(event.delta, event.messageId, event.stepId)
      status.value = 'streaming'
    }
    if (event.type === 'reasoning-delta') {
      session.appendLocalReasoningDelta(event.delta, event.messageId, event.stepId)
      status.value = 'streaming'
    }
    if (event.type === 'tool-input-start') {
      const existing = toolRuns.value.find(
        (item) => item.toolCallId === event.toolCallId,
      )
      if (!existing || existing.status === 'running') {
        const run: ToolRun = {
          toolCallId: event.toolCallId,
          name: event.name,
          status: 'running',
          args: existing?.args,
        }
        toolRuns.value = [
          ...toolRuns.value.filter((item) => item.toolCallId !== event.toolCallId),
          run,
        ]
        session.upsertLocalToolRun(run)
        status.value = 'streaming'
      }
    }
    if (event.type === 'tool-start') {
      const run: ToolRun = {
        toolCallId: event.toolCallId,
        name: event.name,
        status: 'running',
        args: event.args,
      }
      toolRuns.value = [
        ...toolRuns.value.filter((item) => item.toolCallId !== event.toolCallId),
        run,
      ]
      session.upsertLocalToolRun(run)
      status.value = 'streaming'
      if (event.name === 'call_mcp_tool') {
        deps.startMcpAuthPolling()
        deps.syncPendingMcpAuth()
      }
    }
    if (event.type === 'tool-result') {
      deps.syncPendingMcpAuth()
      const existing = toolRuns.value.find(
        (item) => item.toolCallId === event.toolCallId,
      )
      const run: ToolRun = {
        toolCallId: event.toolCallId,
        name: existing?.name ?? 'tool',
        status: event.isError ? 'error' : 'done',
        args: existing?.args,
        result: event.result,
        artifact: event.artifact ?? existing?.artifact,
        diffs: event.diffs ?? existing?.diffs,
      }
      toolRuns.value = toolRuns.value.map((item) =>
        item.toolCallId === event.toolCallId ? run : item,
      )
      session.upsertLocalToolRun(run)
    }
    if (event.type === 'todo-update') {
      session.appendLocalTodoUpdate(event.todos)
    }
    if (event.type === 'subagent-start') {
      const entry: SubagentEntry = {
        subagentId: event.subagentId,
        name: event.name,
        blocking: event.blocking,
        status: 'running',
        events: [],
      }
      subagents.value = [
        ...subagents.value.filter((item) => item.subagentId !== event.subagentId),
        entry,
      ]
      session.upsertLocalSubagentStart({
        subagentId: event.subagentId,
        toolCallId: event.toolCallId,
        name: event.name,
        blocking: event.blocking,
        prompt: event.prompt,
        model: event.model,
      })
    }
    if (event.type === 'subagent-event') {
      const targetId =
        event.subagentId ||
        [...subagents.value].reverse().find((item) => item.status === 'running')
          ?.subagentId
      if (targetId) {
        subagents.value = subagents.value.map((item) =>
          item.subagentId === targetId
            ? { ...item, events: [...item.events, event.event] }
            : item,
        )
        session.appendLocalSubagentToolEvent(targetId, event.event)
      }
    }
    if (event.type === 'pending-subagent') {
      session.setLocalSubagentPrompt(event.subagentId, event.prompt)
    }
    if (event.type === 'subagent-result') {
      const resultStatus = mapSubagentResultStatus(event.outcome, event.summary)
      subagents.value = subagents.value.map((item) =>
        item.subagentId === event.subagentId
          ? { ...item, status: resultStatus, summary: event.summary }
          : item,
      )
      session.completeLocalSubagent(event.subagentId, event.summary, resultStatus)
      deps.maybeFlushBackgroundSubagentResume()
    }
    if (event.type === 'question-request') {
      session.setPendingQuestion({
        toolCallId: event.toolCallId,
        question: event.question,
        options: event.options,
      })
      attention.setChatAttention('needs_input')
    }
    if (event.type === 'step-start') {
      session.startAgentStep(event.stepId)
    }
    if (event.type === 'step-finish') {
      session.finishAgentStep()
    }
    if (event.type === 'tool-pending-approval') {
      const view: PendingApprovalView = {
        toolCallId: event.toolCallId,
        name: event.name,
        kind: event.kind,
        title: event.title,
        detail: event.detail,
        unsandboxed: event.unsandboxed,
        needsNetwork: event.needsNetwork,
        allowedScopes: event.allowedScopes,
        diff: event.diff,
        subagentId: event.subagentId,
        subagentLabel: event.subagentLabel,
      }
      pendingApprovals.value = [...pendingApprovals.value, view]
      attention.setChatAttention('needs_approval')
    }
    if (event.type === 'context-budget') {
      contextUsage.setBudget(
        {
          modelId: event.modelId,
          used: event.used,
          promptUsed: event.promptUsed,
          limit: event.limit,
          reservedOutput: event.reservedOutput,
          safetyBuffer: event.safetyBuffer,
          free: event.free,
          buckets: event.buckets,
        },
        { clearProviderFill: true },
      )
    }
    if (event.type === 'context-usage') {
      contextUsage.setLastStepUsage({
        promptTokens: event.promptTokens,
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
        cacheReadTokens: event.cacheReadTokens,
        cacheWriteTokens: event.cacheWriteTokens,
      })
      // Recount from timeline so Conversation includes tool I/O from this step.
      contextBudgetSync.refreshContextBudget().catch((error) => {
        toast.error('Failed to refresh context usage', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    if (event.type === 'billable-usage') {
      const existing = billableUsageRecords.value
      const without = existing.filter((entry) => entry.id !== event.record.id)
      billableUsageRecords.value = [...without, event.record]
    }
    if (event.type === 'turn-usage') {
      turnUsageByTurnId.value = {
        ...turnUsageByTurnId.value,
        [event.aggregate.turnId]: event.aggregate,
      }
    }
    if (event.type === 'chat-status-changed') {
      status.value = mapMetaStatusToChatStatus(event.status, false)
      session.patchMeta({ status: event.status })
      attention.refreshSidebar()
      if (event.status === 'idle') {
        deps.maybeFlushBackgroundSubagentResume()
      }
    }
    if (event.type === 'chat-meta-changed') {
      if (
        event.projectSlug === options.projectSlug &&
        event.chatId === options.chatId
      ) {
        session.patchMeta(event.patch)
      }
      attention.refreshSidebar()
    }
    if (event.type === 'compaction') {
      session.appendLocalCompaction(event.summary, event.focus)
      contextUsage.clearLastStepUsage()
    }
    if (event.type === 'turn-aborted') {
      status.value = 'ready'
      session.clearPendingQuestion()
      session.finishAgentTurn()
    }
  }

  return { handleEvent }
}
