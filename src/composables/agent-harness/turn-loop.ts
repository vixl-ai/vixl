import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import { resumeOrchestrator } from '@/services/harness/orchestrator'
import { releaseLocksForChat } from '@/services/browser/registry'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  hasPendingBackgroundResume,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
} from '@/services/harness/subagent/registry'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import parseModelRef from '@/utils/parse-model-ref'
import shouldFlushBackgroundSubagentResume from '@/utils/should-flush-background-subagent-resume'
import createSend, { type SendArgs } from './send'
import type { AgentHarnessState, AttentionHelpers } from './types'

type TurnLoopDeps = {
  handleEvent: (event: HarnessEvent) => void
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
  } = state

  const maybeDrainQueue = async (): Promise<void> => {
    while (attention.isFullyIdle()) {
      const item = messageQueue.take()
      if (!item) {
        return
      }
      try {
        await send({
          text: item.text,
          files: item.files,
          mode: item.mode,
          model: item.model,
          reasoning: item.reasoning,
          mentions: item.mentions,
          internal: true,
        })
      } catch (err) {
        toast.error('Failed to send queued message', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
        return
      }
    }
  }

  const { send: sendImpl } = createSend(state, attention, {
    handleEvent: deps.handleEvent,
    persistPermission: deps.persistPermission,
    maybeDrainQueue,
  })

  const send = async (args: SendArgs): Promise<void> => sendImpl(args)

  const resumeAfterBackgroundSubagents = async (): Promise<void> => {
    if (resumingBackgroundBatch.value) {
      return
    }

    const completedResults = listDeliverableBackgroundResults(options.chatId)
    const cfg = lastRunConfig.value
    if (completedResults.length === 0 || !cfg) {
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
        skipUserPersist: true,
        permissionLevel: sessionPermissionLevel.value ?? undefined,
        persistPermission: deps.persistPermission,
        reasoning: cfg.reasoning,
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
      error.value = err instanceof Error ? err.message : 'Unknown error'
      status.value = 'error'
      session.finishAgentTurn()
      attention.applyTurnEndAttention('error')
      toast.error('Agent resume failed', {
        description: error.value,
      })
      await fleetSidebar.refreshSlug(options.projectSlug)
    } finally {
      abortController.value = null
      resumingBackgroundBatch.value = false
    }
  }

  const maybeFlushBackgroundSubagentResume = (): void => {
    const action = shouldFlushBackgroundSubagentResume({
      parentBusy:
        status.value === 'streaming' ||
        status.value === 'submitted' ||
        resumingBackgroundBatch.value,
      hasPending: hasPendingBackgroundResume(options.chatId),
      hasRunning: hasRunningSubagentsForChat(options.chatId),
      deliverableCount: listDeliverableBackgroundResults(options.chatId).length,
    })

    if (action === 'clear') {
      clearPendingBackgroundResume(options.chatId)
      clearTurnResponseMessages(options.chatId)
      releaseLocksForChat(options.chatId, 'run_complete')
      updateChatMeta(options.projectSlug, options.chatId, { status: 'idle' })
        .then(() => {
          session.patchMeta({ status: 'idle' })
          attention.refreshSidebar()
        })
        .catch((err) => {
          toast.error('Failed to update chat status', {
            description: err instanceof Error ? err.message : 'Unknown error',
          })
        })
      return
    }

    if (action !== 'resume') {
      return
    }

    resumeAfterBackgroundSubagents().catch((err) => {
      toast.error('Agent resume failed', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    })
  }

  return {
    send,
    maybeFlushBackgroundSubagentResume,
    maybeDrainQueue,
    resumeAfterBackgroundSubagents,
  }
}
