import { watch } from 'vue'
import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import { resumeOrchestrator } from '@/services/harness/orchestrator'
import {
  agentShellRevision,
  clearPendingShellResume,
  hasRunningParentBackgroundShells,
  listDeliverableShellResults,
  markShellResultsDelivered,
} from '@/services/harness/shell/registry'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
  markBackgroundResultsDelivered,
  subagentRegistryRevision,
} from '@/services/harness/subagent/registry'
import parseModelRef from '@/utils/parse-model-ref'
import createSend, { type SendArgs } from './send'
import flushBackgroundResume from './flush-background-resume'
import { parentFailureStop, writeGuardedTurnStop } from './turn-stop'
import type { AgentHarnessState, AttentionHelpers } from './types'

type TurnLoopDeps = {
  handleEvent: (event: HarnessEvent) => void | Promise<void>
  persistPermission: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
}

export default (
  state: AgentHarnessState,
  attention: AttentionHelpers,
  deps: TurnLoopDeps,
) => {
  const {
    options,
    session,
    status,
    error,
    abortController,
    lastRunConfig,
    resumingBackgroundBatch,
    sessionPermissionLevel,
    fleetSidebar,
    messageQueue,
    suppressQueueDrainAfterStop,
    disposed,
  } = state

  let drainInFlight = false
  let drainAgain = false

  const maybeDrainQueue = async (): Promise<void> => {
    if (suppressQueueDrainAfterStop.value) {
      return
    }
    if (drainInFlight) {
      drainAgain = true
      return
    }
    drainInFlight = true
    try {
      do {
        drainAgain = false
        while (
          attention.isFullyIdle() &&
          !suppressQueueDrainAfterStop.value
        ) {
          const item = messageQueue.take()
          if (!item) {
            break
          }
          try {
            await send({
              text: item.text,
              files: item.files,
              mode: item.mode,
              model: item.model,
              reasoning: item.reasoning,
              mentions: item.mentions,
              skipUserMessage: item.skipUserMessage,
              skipUserPersist: item.skipUserPersist,
              appendedUserMessageId: item.appendedUserMessageId,
              internal: true,
            })
          } catch (err) {
            toast.error('Failed to send queued message', {
              description: err instanceof Error ? err.message : 'Unknown error',
            })
            return
          }
        }
      } while (
        drainAgain &&
        attention.isFullyIdle() &&
        !suppressQueueDrainAfterStop.value
      )
    } finally {
      drainInFlight = false
    }
  }

  const { send: sendImpl } = createSend(state, attention, {
    handleEvent: deps.handleEvent,
    persistPermission: deps.persistPermission,
    maybeDrainQueue,
  })

  const send = async (args: SendArgs): Promise<void> => {
    await sendImpl(args)
    handleBecameIdle()
  }

  const resumeAfterBackgroundSubagents = async (): Promise<void> => {
    if (resumingBackgroundBatch.value) {
      return
    }

    const completedResults = listDeliverableBackgroundResults(options.chatId)
    const shellResults = listDeliverableShellResults(options.chatId)
    const cfg = lastRunConfig.value
    if ((completedResults.length === 0 && shellResults.length === 0) || !cfg) {
      return
    }

    if (!cfg.model) {
      toast.error('Select a model before resuming')
      return
    }

    const parsedModel = parseModelRef(cfg.model)
    if (!parsedModel) {
      toast.error('Select a valid model before resuming')
      return
    }

    resumingBackgroundBatch.value = true
    error.value = null
    status.value = 'submitted'

    const turnId = crypto.randomUUID()
    session.startAgentTurn(turnId)

    const controller = new AbortController()
    abortController.value = controller

    try {
      await resumeOrchestrator({
        workspace: options,
        projectSlug: options.projectSlug,
        chatId: options.chatId,
        projectRoot: options.projectRoot,
        projectName: options.projectName,
        mode: cfg.mode,
        modelId: parsedModel.modelId,
        providerId: parsedModel.providerId,
        settings: cfg.effectiveSettings,
        messages: session.messages.value,
        timeline: session.timeline.value,
        mentions: cfg.mentions,
        signal: controller.signal,
        onEvent: deps.handleEvent,
        assistantId: turnId,
        completedResults,
        shellResults,
        skipUserPersist: true,
        permissionLevel: sessionPermissionLevel.value ?? undefined,
        persistPermission: deps.persistPermission,
        reasoning: cfg.reasoning,
        sessionAllows: state.sessionAllows,
        sessionDenies: state.sessionDenies,
      })
      status.value = 'ready'
      session.finishAgentTurn()
      attention.applyTurnEndAttention('success')
      await fleetSidebar.refreshSlug(options.projectSlug)
      await maybeDrainQueue()
    } catch (err) {
      const aborted = controller.signal.aborted
      if (aborted) {
        status.value = 'ready'
        session.finishAgentTurn()
        await fleetSidebar.refreshSlug(options.projectSlug)
        return
      }
      markBackgroundResultsDelivered(
        options.chatId,
        completedResults.map((item) => item.toolCallId),
      )
      if (!hasRunningSubagentsForChat(options.chatId)) {
        clearPendingBackgroundResume(options.chatId)
      }
      markShellResultsDelivered(
        options.chatId,
        shellResults.map((item) => item.toolCallId),
      )
      if (
        !hasRunningParentBackgroundShells(options.chatId) &&
        listDeliverableShellResults(options.chatId).length === 0
      ) {
        clearPendingShellResume(options.chatId)
      }
      clearTurnResponseMessages(options.chatId)
      error.value = err instanceof Error ? err.message : 'Unknown error'
      status.value = 'error'
      await writeGuardedTurnStop({
        timeline: session.timeline.value,
        turnId,
        turnIdRemap: session.turnIdRemap,
        stop: parentFailureStop(err),
        projectSlug: options.projectSlug,
        chatId: options.chatId,
        setAgentTurnStop: (id, stop) => {
          session.setAgentTurnStop(id, stop)
        },
      })
      session.finishAgentTurn()
      attention.applyTurnEndAttention('error')
      toast.error('Agent resume failed', {
        description: error.value,
      })
      await fleetSidebar.refreshSlug(options.projectSlug)
    } finally {
      abortController.value = null
      resumingBackgroundBatch.value = false
      handleBecameIdle()
    }
  }

  const maybeFlushBackgroundSubagentResume = (): void => {
    flushBackgroundResume({
      chatId: options.chatId,
      projectSlug: options.projectSlug,
      parentBusy: attention.isParentBusy(),
      patchMeta: (patch) => {
        session.patchMeta(patch)
      },
      refreshSidebar: () => {
        attention.refreshSidebar()
      },
      resume: resumeAfterBackgroundSubagents,
    })
  }

  const drainQueueFromIdle = (): void => {
    maybeDrainQueue().catch((err: unknown) => {
      toast.error('Failed to send queued message', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    })
  }

  const handleBecameIdle = (): void => {
    if (disposed.value || suppressQueueDrainAfterStop.value) {
      return
    }
    if (abortController.value || attention.isParentBusy()) {
      return
    }
    maybeFlushBackgroundSubagentResume()
    if (attention.isFullyIdle()) {
      drainQueueFromIdle()
    }
  }

  watch(
    () => {
      const parentBusy = attention.isParentBusy()
      const fullyIdle = attention.isFullyIdle()
      const runningCount = state.subagents.value.filter(
        (item) => item.status === 'running',
      ).length
      return [
        parentBusy,
        fullyIdle,
        runningCount,
        status.value,
        state.compacting.value,
        resumingBackgroundBatch.value,
        abortController.value,
        suppressQueueDrainAfterStop.value,
        subagentRegistryRevision.value,
        agentShellRevision.value,
      ].join(':')
    },
    () => {
      handleBecameIdle()
    },
  )

  return {
    send,
    maybeFlushBackgroundSubagentResume,
    maybeDrainQueue,
    resumeAfterBackgroundSubagents,
  }
}
