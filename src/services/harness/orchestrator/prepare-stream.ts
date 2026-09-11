import type { LanguageModel, ModelMessage, UIMessage } from 'ai'
import type { SystemPromptParts } from '@/services/context/system-prompt-parts/types'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'
import { isReasoningLevel } from '@/types/models/reasoning-level'
import createModel from '@/services/providers/create-model'
import { readChatMeta, updateChatMeta } from '@/services/vixl/vixl-tauri'
import assembleSystemPromptParts from '@/services/context/system-prompt-parts/assemble'
import buildMentionInjectionText from '@/services/context/system-prompt-parts/build-mention-injection-text'
import joinSystemPromptParts from '@/services/context/system-prompt-parts/join'
import {
  buildPrefixSnapshot,
  frozenPrefixMatchesMode,
  getFrozenPrefix,
  partsFromFrozenPrefix,
} from '@/services/harness/prefix-contract'
import countContextBudget from '@/services/context/count-context-budget'
import buildTools from '@/services/harness/build-tools'
import {
  beginPlanExecutionTurn,
  hydratePlanExecutionSession,
} from '@/services/harness/plan-execution-session'
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  resolveModelCallOptions,
} from '@/services/models/resolve-model-call-options'
import {
  pickResolvedReasoning,
  resolveCatalogReasoning,
  resolveReasoningForRole,
} from '@/services/models/resolve-reasoning-for-call'
import resolveModelRefForCall from '@/services/models/resolve-model-ref-for-call'
import { toast } from 'vue-sonner'
import formatUnknownError from '@/utils/format-unknown-error'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import { stageImage } from '@/services/harness/image-stage'
import type { StagedImage } from '@/types/harness/staged-image'
import {
  filterToolsForMode,
  injectContextIntoLastUserMessage,
} from './helpers'
import {
  persistPendingSubagent,
  persistSubagentHarnessEvent,
} from './persistence'
import bindLiveToolContext from './live-tool-context'
import resolveLiveWorkspace from './resolve-workspace'
import createStreamSteps from './stream-steps'

const MAX_OUTPUT_TOKENS = DEFAULT_MAX_OUTPUT_TOKENS

export type PreparedHarnessStream = {
  model: LanguageModel
  system: string
  finalModelMessages: ModelMessage[]
  tools: Partial<ReturnType<typeof buildTools>>
  callModel: ReturnType<typeof resolveModelRefForCall>
  callOptions: ReturnType<typeof resolveModelCallOptions>
  steps: ReturnType<typeof createStreamSteps>
  workspace: HarnessWorkspace
  chatId: string
  modelId: string
  settings: HarnessStreamInput['settings']
  assistantId: string
  signal: AbortSignal
  onEvent: (event: HarnessEvent) => void | Promise<void>
  captureTurnMessages: boolean
  messages: UIMessage[]
}

export default async (input: HarnessStreamInput): Promise<PreparedHarnessStream> => {
  const workspace = resolveLiveWorkspace(input)
  const {
    chatId,
    mode,
    modelId,
    providerId,
    settings,
    mentions,
    messages,
    timeline,
    modelMessages,
    userMessageId,
    signal,
    onEvent,
    assistantId,
    captureTurnMessages,
  } = input
  const projectRoot = workspace.projectRoot
  const projectName = workspace.projectName

  const callModel = resolveModelRefForCall(settings, { providerId, modelId })

  const [existingMeta, model] = await Promise.all([
    readChatMeta(workspace.projectSlug, chatId).catch(() => null),
    createModel({
      providerId: callModel.createRef.providerId,
      modelId: callModel.createRef.modelId,
      settings,
    }),
  ])

  const planSession = beginPlanExecutionTurn(workspace.projectSlug, chatId)
  if (existingMeta) {
    hydratePlanExecutionSession(workspace.projectSlug, chatId, {
      awaitingPlanGo: existingMeta.awaitingPlanGo ?? null,
      subagentModel: existingMeta.subagentModel ?? null,
      subagentReasoning: isReasoningLevel(existingMeta.subagentReasoning)
        ? existingMeta.subagentReasoning
        : null,
    })
  }

  const supportsVision = await resolveModelVision({
    model,
    providerId: callModel.createRef.providerId,
    modelId: callModel.createRef.modelId,
    settings,
  })

  const frozenSnapshot = existingMeta ? getFrozenPrefix(existingMeta) : null

  const freshParts = await assembleSystemPromptParts({
    mode,
    projectName,
    projectRoot,
    mentions: [],
    agentCatalog: [],
    standalone: workspace.standalone,
  })
  // Mentions are injected into the last user message, not the frozen prefix.
  const prefixParts: SystemPromptParts = { ...freshParts, mentions: '' }
  const candidateSystem = joinSystemPromptParts(prefixParts)
  const candidate = buildPrefixSnapshot({
    systemString: candidateSystem,
    toolSchemasJson: freshParts.tools,
    mcpCatalogSnapshot: freshParts.mcp,
    rulesBodies: [freshParts.agentsMd, freshParts.rules].filter(Boolean).join('\n\n'),
    mode,
    parts: prefixParts,
  })

  const reuseFrozen =
    frozenSnapshot !== null &&
    frozenPrefixMatchesMode(frozenSnapshot, mode) &&
    frozenSnapshot.hash === candidate.hash

  let system: string
  let parts: SystemPromptParts

  if (reuseFrozen && frozenSnapshot) {
    system = frozenSnapshot.systemString
    parts = partsFromFrozenPrefix(frozenSnapshot)
  } else {
    system = candidateSystem
    parts = prefixParts

    updateChatMeta(workspace.projectSlug, chatId, {
      prefixSnapshot: candidate as unknown as Record<string, unknown>,
    }).catch((error: unknown) => {
      toast.error('Failed to persist chat prefix', {
        description: formatUnknownError(error),
      })
    })
    onEvent({
      type: 'chat-meta-changed',
      projectSlug: workspace.projectSlug,
      chatId,
      patch: { prefixSnapshot: candidate },
    })
  }

  const mentionsText = buildMentionInjectionText(mentions)
  const finalModelMessages = mentionsText
    ? injectContextIntoLastUserMessage(modelMessages, mentionsText)
    : modelMessages

  const budget = await countContextBudget({
    modelId,
    providerId,
    settings,
    mode,
    projectName,
    projectRoot,
    mentions,
    messages,
    timeline,
    standalone: workspace.standalone,
    parts,
    frozenSnapshot,
    activeContext: input.activeContext,
  })
  onEvent({
    type: 'context-budget',
    modelId,
    used: budget.used,
    promptUsed: budget.promptUsed,
    limit: budget.limit,
    reservedOutput: budget.reservedOutput,
    safetyBuffer: budget.safetyBuffer,
    free: budget.free,
    buckets: budget.buckets,
  })

  const callOptions = resolveModelCallOptions(settings, callModel.optionRef, {
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    reasoning: pickResolvedReasoning([
      input.reasoning,
      resolveCatalogReasoning(settings, callModel.optionRef),
      resolveReasoningForRole(mode, settings),
    ]),
  })

  const handleHarnessEvent = (event: HarnessEvent): void | Promise<void> => {
    if (
      event.type === 'subagent-start' ||
      event.type === 'subagent-result' ||
      event.type === 'subagent-event'
    ) {
      persistSubagentHarnessEvent(workspace.projectSlug, chatId, event).catch((error) => {
        toast.error('Failed to save subagent event', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    if (event.type === 'pending-subagent') {
      persistPendingSubagent(workspace.projectSlug, chatId, event).catch((error) => {
        toast.error('Failed to save pending subagent', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    return onEvent(event)
  }

  const sessionAllows = input.sessionAllows
  const sessionDenies = input.sessionDenies

  const allTools = buildTools(
    bindLiveToolContext(workspace, {
      chatId,
      mode,
      userMessageId,
      // AgentTurn.id is passed as assistantId from use-agent-harness.
      turnId: assistantId,
      settings,
      permissionLevel: input.permissionLevel ?? settings['agent.permissionLevel'] ?? 'allowlist',
      sessionAllows,
      sessionDenies,
      sandboxEnabled: settings['agent.sandbox.enabled'] ?? true,
      supportsVision,
      ...(supportsVision
        ? {
            stageImage: (image: StagedImage) =>
              stageImage({
                chatId,
                turnId: assistantId,
                image,
              }),
          }
        : {}),
      onPendingApproval: (entry) => {
        onEvent({
          type: 'tool-pending-approval',
          toolCallId: entry.toolCallId,
          name: entry.name,
          kind: entry.kind,
          title: entry.title,
          detail: entry.detail,
          unsandboxed: entry.unsandboxed,
          needsNetwork: entry.needsNetwork,
          allowedScopes: entry.allowedScopes,
          diff: entry.diff ?? [],
          subagentId: entry.subagentId,
          subagentLabel: entry.subagentLabel,
        })
      },
      persistPermission: input.persistPermission,
      onHarnessEvent: handleHarnessEvent,
      signal,
    }),
  )
  const tools = filterToolsForMode(mode, allTools, {
    awaitingPlanGo: Boolean(planSession.awaitingPlanGo),
  })

  const steps = createStreamSteps({ workspace, chatId, onEvent })

  return {
    model,
    system,
    finalModelMessages,
    tools,
    callModel,
    callOptions,
    steps,
    workspace,
    chatId,
    modelId,
    settings,
    assistantId,
    signal,
    onEvent,
    captureTurnMessages,
    messages,
  }
}
