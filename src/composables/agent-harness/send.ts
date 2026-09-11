import { toast } from 'vue-sonner'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import runOrchestrator from '@/services/harness/orchestrator'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import parseModelRef from '@/utils/parse-model-ref'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import { listAgentIndex } from '@/services/agents/registry'
import dropUnresolvedAgentMentions from '@/services/agents/drop-unresolved-agent-mentions'
import buildMentionHighlights from '@/utils/build-mention-highlights'
import collectExplicitAgentMentions from '@/utils/collect-explicit-agent-mentions'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import filenameWithMediaTypeExtension from '@/utils/filename-with-media-type-extension'
import normalizeImageDataUrl from '@/utils/normalize-image-data-url'
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
  handleEvent: (event: HarnessEvent) => void | Promise<void>
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
    const pending = session.pendingQuestion.value
    if (!args.internal && pending && args.text.trim().length > 0) {
      session.submitAnswer(pending.toolCallId, args.text)
      attention.maybeClearAttentionWhenGatesEmpty()
      return
    }

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

    const projectRoot = options.standalone ? null : options.projectRoot
    let chatSettings: VixlSettings
    try {
      chatSettings = await loadEffectiveSettings(projectRoot)
    } catch (settingsError) {
      toast.error('Failed to load project settings', {
        description:
          settingsError instanceof Error ? settingsError.message : 'Unknown error',
      })
      return
    }

    error.value = null
    status.value = 'submitted'
    toolRuns.value = []
    subagents.value = []

    const agentIndex = await listAgentIndex(projectRoot).catch(() => [])
    const mentions = await dropUnresolvedAgentMentions(
      collectExplicitAgentMentions(args.text, args.mentions ?? [], agentIndex),
      projectRoot,
    )

    lastRunConfig.value = {
      mode: args.mode,
      model: args.model,
      reasoning: args.reasoning,
      mentions,
      effectiveSettings: chatSettings,
    }
    contextBudgetSync.setDraftMentions(mentions)

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

    const controller = new AbortController()
    abortController.value = controller

    try {
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

          if (!url) {
            continue
          }

          let mediaType = file.mediaType || 'image/png'
          let partUrl = url
          let filename = file.filename
          if (url.startsWith('data:') && mediaType.startsWith('image/')) {
            const normalized = await normalizeImageDataUrl({
              dataUrl: url,
              mediaType,
            })
            if (normalized.mediaType !== mediaType) {
              filename = filenameWithMediaTypeExtension(
                filename,
                normalized.mediaType,
              )
            }
            mediaType = normalized.mediaType
            partUrl = normalized.dataUrl
          }
          parts.push({
            type: 'file',
            mediaType,
            url: partUrl,
            filename,
          })
        }

        if (controller.signal.aborted) {
          status.value = 'ready'
          await fleetSidebar.refreshSlug(options.projectSlug)
          return
        }

        const skillNames = (
          await listSlashSkillIndex(projectRoot).catch(() => [])
        ).map((skill) => skill.name)
        const agentNames = agentIndex.map((agent) => agent.name)

        const mentionHighlights = buildMentionHighlights(
          args.text,
          mentions,
          skillNames,
          agentNames,
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

      if (controller.signal.aborted) {
        status.value = 'ready'
        await fleetSidebar.refreshSlug(options.projectSlug)
        return
      }

      const turnId = crypto.randomUUID()
      session.startAgentTurn(turnId)

      await runOrchestrator({
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
      const payloadHint = /invalid json response body/i.test(message)
        ? ' The provider rejected the request payload. Try smaller or fewer images.'
        : ''
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
            : `${message}${payloadHint}`,
      })
      session.finishAgentTurn()
      attention.applyTurnEndAttention('error')
      toast.error('Agent run failed', {
        description: error.value.includes('No output generated')
          ? 'The model returned an empty response. Check your Gateway API key and model ID in Settings.'
          : `${error.value}${payloadHint}`,
      })
      await fleetSidebar.refreshSlug(options.projectSlug)
    } finally {
      contextBudgetSync.setDraftMentions([])
      abortController.value = null
    }
  }

  return { send }
}
