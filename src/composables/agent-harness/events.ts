import type { HarnessEvent } from '@/types/harness/harness-event'
import type { ToolRun } from '@/types/harness/tool-run'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mapMetaStatusToChatStatus } from '@/services/harness/orchestrator'
import mapSubagentResultStatus from '@/utils/map-subagent-result-status'
import mergeToolRunArgs from '@/utils/merge-tool-run-args'
import toolArgsPath from '@/utils/tool-args-path'
import applyVisibleContextEvent from './apply-visible-context-event'
import rebindWorkspace from './rebind-workspace'
import type { AgentHarnessState, AttentionHelpers } from './types'

const HOLD_PATH_TOOLS = new Set(['write_file', 'edit_file'])

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
    compacting,
  } = state

  const handleEvent = (event: HarnessEvent): void | Promise<void> => {
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
      if (HOLD_PATH_TOOLS.has(event.name)) {
        status.value = 'streaming'
      } else {
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
    }
    if (event.type === 'tool-input-delta') {
      const existing = toolRuns.value.find(
        (item) => item.toolCallId === event.toolCallId,
      )
      const name = event.name || existing?.name || 'tool'
      const args = mergeToolRunArgs(existing?.args, event.args)
      if (HOLD_PATH_TOOLS.has(name) && !toolArgsPath(args)) {
        status.value = 'streaming'
      } else if (!existing || existing.status === 'running') {
        const run: ToolRun = {
          toolCallId: event.toolCallId,
          name,
          status: 'running',
          args,
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
      const existing = toolRuns.value.find(
        (item) => item.toolCallId === event.toolCallId,
      )
      const run: ToolRun = {
        toolCallId: event.toolCallId,
        name: event.name,
        status: 'running',
        args: mergeToolRunArgs(existing?.args, event.args),
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
      subagents.value = [
        ...subagents.value.filter((item) => item.subagentId !== event.subagentId),
        {
          subagentId: event.subagentId,
          name: event.name,
          blocking: event.blocking,
          status: 'running',
          events: [],
        },
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
    if (event.type === 'compaction-started') {
      compacting.value = true
    }
    if (event.type === 'compaction-ended') {
      compacting.value = false
    }
    if (event.type === 'compaction') {
      session.appendLocalCompaction(event.summary, event.focus)
      compacting.value = false
    }
    if (event.type === 'turn-aborted') {
      status.value = 'ready'
      session.clearPendingQuestion()
      session.finishAgentTurn()
    }
    if (event.type === 'workspace-moved') {
      return rebindWorkspace(state, event)
    }
    applyVisibleContextEvent(state, event)
  }

  return { handleEvent }
}
