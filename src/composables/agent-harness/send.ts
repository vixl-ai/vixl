import { toast } from 'vue-sonner'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import parseModelRef from '@/utils/parse-model-ref'
import { listAgentIndex } from '@/services/agents/registry'
import dropUnresolvedAgentMentions from '@/services/agents/drop-unresolved-agent-mentions'
import collectExplicitAgentMentions from '@/utils/collect-explicit-agent-mentions'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import flushPendingBackgroundResume from '@/services/harness/subagent/flush-pending-resume'
import { hasPendingBackgroundResume } from '@/services/harness/subagent/registry'
import normalizeAttachmentFiles from '@/utils/normalize-attachment-files'
import appendSendUserMessage from './append-send-user-message'
import applyParentTurnStart from './apply-parent-turn-start'
import deferOverlappingParentTurn from './defer-overlapping-parent-turn'
import enqueueComposerSend from './enqueue-composer-send'
import handleSendCatch from './handle-send-catch'
import runParentOrchestrator from './run-parent-orchestrator'
import type { AgentHarnessState, AttentionHelpers } from './types'

export type SendArgs = {
  text: string
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  mentions?: ContextMention[]
  files?: FileUIPart[]
  skipUserMessage?: boolean
  skipUserPersist?: boolean
  appendedUserMessageId?: string
  continueTurnId?: string
  // Internal sends (drain, retry, edit, forceSendQueued) bypass the outbound
  // composer busy enqueue. They still defer when compaction or a background
  // resume is in flight: drain/retry/edit re-enqueue, force-send waits first.
  // Continue toasts instead of enqueueing.
  internal?: boolean
  autoRetryAttempt?: number
}

export type SendResult = 'completed' | 'failed' | 'skipped'

type SendDeps = {
  handleEvent: (event: HarnessEvent) => void | Promise<void>
  persistPermission: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  maybeDrainQueue: () => Promise<void>
}

export default (state: AgentHarnessState, attention: AttentionHelpers, deps: SendDeps) => {
  const {
    options,
    session,
    config,
    status,
    error,
    toolRuns,
    abortController,
    resumingBackgroundBatch,
    compacting,
    sessionPermissionLevel,
    contextBudgetSync,
    fleetSidebar,
    messageQueue,
    suppressQueueDrainAfterStop,
  } = state

  const send = async (args: SendArgs): Promise<SendResult> => {
    const pending = session.pendingQuestion.value
    if (!args.internal && pending && args.text.trim().length > 0) {
      session.submitAnswer(pending.toolCallId, args.text)
      attention.maybeClearAttentionWhenGatesEmpty()
      return 'skipped'
    }

    if (!args.internal && attention.isParentBusy()) {
      enqueueComposerSend(messageQueue, args)
      return 'skipped'
    }

    if (
      (status.value === 'streaming' || status.value === 'submitted') &&
      args.autoRetryAttempt == null
    ) {
      return 'skipped'
    }

    if (!args.model) {
      toast.error('Select a model before sending')
      return 'skipped'
    }

    if (!config.hydrated.value) {
      toast.error('Settings are still loading')
      return 'skipped'
    }

    if (listConfiguredProviders(config.effectiveSettings.value).length === 0) {
      toast.error('No provider configured', {
        description: 'Add a provider in Settings.',
      })
      return 'skipped'
    }

    const parsedModel = parseModelRef(args.model)
    if (!parsedModel) {
      toast.error('Select a valid model before sending')
      return 'skipped'
    }

    const settingsRoot = options.standalone ? null : options.projectRoot
    const catalogRoot = options.projectRoot
    let chatSettings: VixlSettings
    try {
      chatSettings = await loadEffectiveSettings(settingsRoot)
    } catch (settingsError) {
      toast.error('Failed to load project settings', {
        description: settingsError instanceof Error ? settingsError.message : 'Unknown error',
      })
      return 'skipped'
    }

    if (!args.internal && attention.isParentBusy()) {
      enqueueComposerSend(messageQueue, args)
      return 'skipped'
    }

    error.value = null
    status.value = 'submitted'
    toolRuns.value = []

    const agentIndex = await listAgentIndex(catalogRoot).catch(() => [])
    const mentions = await dropUnresolvedAgentMentions(
      collectExplicitAgentMentions(args.text, args.mentions ?? [], agentIndex),
      catalogRoot,
    )

    const previousAbort = abortController.value
    const controller = new AbortController()
    abortController.value = controller
    let turnStarted = false
    let turnId: string | undefined
    let appendedUserMessageId = args.appendedUserMessageId

    try {
      let files: FileUIPart[]
      try {
        files = await normalizeAttachmentFiles(args.files ?? [])
      } catch (normalizeError) {
        toast.error('Could not attach image', {
          description: normalizeError instanceof Error ? normalizeError.message : 'Unknown error',
        })
        status.value = 'ready'
        await fleetSidebar.refreshSlug(options.projectSlug)
        return 'skipped'
      }

      if (
        !args.continueTurnId &&
        args.text.trim().length === 0 &&
        !files.some((file) => Boolean(file.url))
      ) {
        toast.error('Nothing to send', {
          description: 'Attachments could not be restored.',
        })
        status.value = 'ready'
        await fleetSidebar.refreshSlug(options.projectSlug)
        return 'skipped'
      }

      let userMessageAppended = false
      if (!args.skipUserMessage) {
        const appended = await appendSendUserMessage({
          session,
          text: args.text,
          model: args.model,
          files,
          mentions,
          agentNames: agentIndex.map((agent) => agent.name),
          projectRoot: catalogRoot,
          aborted: () => controller.signal.aborted,
        })
        if (!appended) {
          status.value = 'ready'
          await fleetSidebar.refreshSlug(options.projectSlug)
          return 'skipped'
        }
        appendedUserMessageId = appended.id
        userMessageAppended = true
      }

      if (controller.signal.aborted) {
        status.value = 'ready'
        await fleetSidebar.refreshSlug(options.projectSlug)
        return 'skipped'
      }

      if (
        deferOverlappingParentTurn({
          resumeInFlight: resumingBackgroundBatch.value,
          compacting: compacting.value,
          continueTurnId: args.continueTurnId,
          suppressBusyToast: args.autoRetryAttempt != null,
          enqueue: () =>
            enqueueComposerSend(messageQueue, {
              ...args,
              skipUserMessage: args.skipUserMessage || userMessageAppended,
              skipUserPersist: args.skipUserPersist || userMessageAppended,
              appendedUserMessageId,
            }),
          abortController,
          controller,
          previousAbort,
          status,
        })
      ) {
        await fleetSidebar.refreshSlug(options.projectSlug)
        return 'skipped'
      }

      await applyParentTurnStart({
        state,
        mode: args.mode,
        model: args.model,
        reasoning: args.reasoning,
        mentions,
        effectiveSettings: chatSettings,
      })

      turnId = args.continueTurnId ?? crypto.randomUUID()
      if (args.continueTurnId) {
        session.resumeAgentTurn(args.continueTurnId)
      } else {
        session.startAgentTurn(turnId)
      }
      turnStarted = true
      suppressQueueDrainAfterStop.value = false
      if (
        !args.internal &&
        !resumingBackgroundBatch.value &&
        hasPendingBackgroundResume(options.chatId)
      ) {
        flushPendingBackgroundResume(options.chatId)
      }

      await runParentOrchestrator({
        workspace: options,
        projectSlug: options.projectSlug,
        chatId: options.chatId,
        projectRoot: options.projectRoot,
        projectName: options.projectName,
        mode: args.mode,
        modelId: parsedModel.modelId,
        providerId: parsedModel.providerId,
        settings: chatSettings,
        messages: session.messages.value,
        timeline: session.timeline.value,
        userText: args.text,
        appendedUserMessageId,
        mentions,
        signal: controller.signal,
        onEvent: deps.handleEvent,
        assistantId: turnId,
        skipUserPersist: args.skipUserPersist,
        standalone: options.standalone,
        permissionLevel: sessionPermissionLevel.value ?? undefined,
        persistPermission: deps.persistPermission,
        reasoning: args.reasoning,
        sessionAllows: state.sessionAllows,
        sessionDenies: state.sessionDenies,
        continueTurnId: args.continueTurnId,
      })
      status.value = 'ready'
      session.finishAgentTurn()
      attention.applyTurnEndAttention('success')
      await fleetSidebar.refreshSlug(options.projectSlug)
      if (!args.internal) {
        await deps.maybeDrainQueue()
      }
      return 'completed'
    } catch (err) {
      return await handleSendCatch({
        err,
        aborted: controller.signal.aborted,
        turnStarted,
        turnId,
        appendedUserMessageId,
        args,
        status,
        error,
        abortController,
        session,
        suppressQueueDrainAfterStop,
        resumeInFlight: resumingBackgroundBatch,
        projectSlug: options.projectSlug,
        refreshSlug: (slug) => fleetSidebar.refreshSlug(slug),
        applyTurnEndAttention: (outcome) => {
          attention.applyTurnEndAttention(outcome)
        },
        maybeDrainQueue: deps.maybeDrainQueue,
        send,
      })
    } finally {
      contextBudgetSync.setDraftMentions([])
      if (abortController.value === controller) {
        abortController.value = null
      }
    }
  }

  return { send }
}
