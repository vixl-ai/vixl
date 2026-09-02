import { toast } from 'vue-sonner'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import runOrchestrator from '@/services/harness/orchestrator'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import parseModelRef from '@/utils/parse-model-ref'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import buildMentionHighlights from '@/utils/build-mention-highlights'
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
  // Internal sends (drain, retry, edit, forceSendQueued) bypass the outbound
  // queue and fall through to the streaming/submitted guard below. Only
  // user-initiated sends from the composer enqueue when the harness is busy
  // or waiting on background subagents.
  internal?: boolean
}

type SendDeps = {
  handleEvent: (event: HarnessEvent) => void
  persistPermission: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  maybeDrainQueue: () => Promise<void>
}

export default (
  state: AgentHarnessState,
  attention: AttentionHelpers,
  deps: SendDeps,
) => {
  const {
    options,
    session,
    config,
    status,
    error,
    toolRuns,
    subagents,
    abortController,
    lastRunConfig,
    sessionPermissionLevel,
    contextBudgetSync,
    fleetSidebar,
    messageQueue,
  } = state

  const send = async (args: SendArgs): Promise<void> => {
    if (!args.internal && (attention.isParentBusy() || attention.isWaitingOnBackground())) {
      try {
        messageQueue.enqueue({
          text: args.text,
          files: args.files ?? [],
          mode: args.mode,
          model: args.model,
          reasoning: args.reasoning,
          mentions: args.mentions,
        })
      } catch {
        toast.error('Queue is full', {
          description: 'Remove a queued message first',
        })
      }
      return
    }

    if (status.value === 'streaming' || status.value === 'submitted') {
      return
    }

    if (!args.model) {
      toast.error('Select a model before sending')
      return
    }

    if (!config.hydrated.value) {
      toast.error('Settings are still loading')
      return
    }

    if (listConfiguredProviders(config.effectiveSettings.value).length === 0) {
      toast.error('No provider configured', {
        description: 'Add a provider in Settings.',
      })
      return
    }

    const parsedModel = parseModelRef(args.model)
    if (!parsedModel) {
      toast.error('Select a valid model before sending')
      return
    }

    error.value = null
    status.value = 'submitted'
    toolRuns.value = []
    subagents.value = []

    lastRunConfig.value = {
      mode: args.mode,
      model: args.model,
      reasoning: args.reasoning,
      mentions: args.mentions ?? [],
      effectiveSettings: config.effectiveSettings.value,
    }
    contextBudgetSync.setDraftMentions(args.mentions ?? [])

    try {
      await updateChatMeta(options.projectSlug, options.chatId, {
        model: args.model,
        mode: args.mode,
      })
      session.patchMeta({ model: args.model, mode: args.mode })
    } catch (metaError) {
      toast.error('Failed to save chat model', {
        description:
          metaError instanceof Error ? metaError.message : 'Unknown error',
      })
    }

    if (!args.skipUserMessage) {
      const fileParts = args.files ?? []

      const parts: Array<
        | { type: 'text'; text: string }
        | { type: 'file'; mediaType: string; url: string; filename?: string }
      > = [{ type: 'text', text: args.text }]

      // Always keep file parts on the UI message so the thread can show
      // thumbnails. Non-vision models get text placeholders later, only for
      // convertToModelMessages in the orchestrator.
      for (const file of fileParts) {
        const url = file.url
        if (url?.startsWith('file://')) {
          parts.push({
            type: 'text',
            text: `[Attachment unavailable: ${file.filename || url}]`,
          })
          continue
        }

        if (url) {
          parts.push({
            type: 'file',
            mediaType: file.mediaType || 'image/png',
            url,
            filename: file.filename,
          })
        }
      }

      const skillNames = (
        await listSlashSkillIndex(
          options.standalone ? null : options.projectRoot,
        ).catch(() => [])
      ).map((skill) => skill.name)

      const mentionHighlights = buildMentionHighlights(
        args.text,
        args.mentions ?? [],
        skillNames,
      )

      session.appendLocalMessage({
        id: crypto.randomUUID(),
        role: 'user',
        parts,
        metadata: {
          createdAt: new Date().toISOString(),
          model: args.model,
          ...(mentionHighlights.length > 0 ? { mentionHighlights } : {}),
        },
      })
    }

    const turnId = crypto.randomUUID()
    session.startAgentTurn(turnId)

    const controller = new AbortController()
    abortController.value = controller

    try {
      await runOrchestrator({
        projectSlug: options.projectSlug,
        chatId: options.chatId,
        projectRoot: options.projectRoot,
        projectName: options.projectName,
        mode: args.mode,
        modelId: parsedModel.modelId,
        providerId: parsedModel.providerId,
        settings: config.effectiveSettings.value,
        messages: session.messages.value,
        timeline: session.timeline.value,
        userText: args.text,
        mentions: args.mentions ?? [],
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
      })
      status.value = 'ready'
      session.finishAgentTurn()
      attention.applyTurnEndAttention('success')
      await fleetSidebar.refreshSlug(options.projectSlug)
      if (!args.internal) {
        await deps.maybeDrainQueue()
      }
    } catch (err) {
      const aborted = controller.signal.aborted
      const timedOut =
        err instanceof Error &&
        (err.name === 'TimeoutError' || /timeout/i.test(err.message))
      const message = err instanceof Error ? err.message : 'Unknown error'
      if (aborted) {
        status.value = 'ready'
        session.finishAgentTurn()
        await fleetSidebar.refreshSlug(options.projectSlug)
        return
      }
      error.value = message
      status.value = 'error'
      session.setAgentTurnError({
        kind: timedOut ? 'timeout' : 'error',
        message: timedOut
          ? 'The model took too long to respond.'
          : message.includes('No output generated')
            ? 'The model returned an empty response. Check your API key and model ID in Settings.'
            : message,
      })
      session.finishAgentTurn()
      attention.applyTurnEndAttention('error')
      toast.error('Agent run failed', {
        description: error.value.includes('No output generated')
          ? 'The model returned an empty response. Check your Gateway API key and model ID in Settings.'
          : error.value,
      })
      await fleetSidebar.refreshSlug(options.projectSlug)
    } finally {
      contextBudgetSync.setDraftMentions([])
      abortController.value = null
    }
  }

  return { send }
}
