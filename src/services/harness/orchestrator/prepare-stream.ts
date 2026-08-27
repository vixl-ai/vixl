import type { LanguageModel, ModelMessage, UIMessage } from 'ai'
import type { SystemPromptParts } from '@/services/context/system-prompt-parts'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import { isReasoningLevel } from '@/types/models/reasoning-level'
import createModel from '@/services/providers/create-model'
import { readChatMeta, updateChatMeta } from '@/services/vixl/vixl-tauri'
import assembleSystemPromptParts, {
  formatMentionsAsText,
  joinSystemPromptParts,
} from '@/services/context/system-prompt-parts'
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
import resolveModelVision from '@/services/harness/resolve-model-vision'
import {
  filterToolsForMode,
  injectContextIntoLastUserMessage,
} from './helpers'
import {
  persistPendingSubagent,
  persistSubagentHarnessEvent,
} from './persistence'
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
  projectSlug: string
  chatId: string
  modelId: string
  settings: HarnessStreamInput['settings']
  assistantId: string
  signal: AbortSignal
  onEvent: (event: HarnessEvent) => void
  captureTurnMessages: boolean
  messages: UIMessage[]
}

export default async (input: HarnessStreamInput): Promise<PreparedHarnessStream> => {
  const {
    projectSlug,
    chatId,
    projectRoot,
    projectName,
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

  const callModel = resolveModelRefForCall(settings, { providerId, modelId })

  const [existingMeta, model] = await Promise.all([
    readChatMeta(projectSlug, chatId).catch(() => null),
    createModel({
      providerId: callModel.createRef.providerId,
      modelId: callModel.createRef.modelId,
      settings,
    }),
  ])

  const planSession = beginPlanExecutionTurn(projectSlug, chatId)
  if (existingMeta) {
    hydratePlanExecutionSession(projectSlug, chatId, {
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
  const reuseFrozen =
    frozenSnapshot !== null && frozenPrefixMatchesMode(frozenSnapshot, mode)

  let system: string
  let parts: SystemPromptParts

  if (reuseFrozen && frozenSnapshot) {
    system = frozenSnapshot.systemString
    parts = partsFromFrozenPrefix(frozenSnapshot)
  } else {
    const freshParts = await assembleSystemPromptParts({
      mode,
      projectName,
      projectRoot,
      mentions: [],
      agentCatalog: [],
      standalone: input.standalone,
    })
    // Mentions are injected into the last user message, not the frozen prefix.
    const prefixParts: SystemPromptParts = { ...freshParts, mentions: '' }
    system = joinSystemPromptParts(prefixParts)
    parts = prefixParts

    const snapshot = buildPrefixSnapshot({
      systemString: system,
      toolSchemasJson: freshParts.tools,
      mcpCatalogSnapshot: freshParts.mcp,
      rulesBodies: freshParts.rules,
      mode,
      parts: prefixParts,
    })
    updateChatMeta(projectSlug, chatId, {
      prefixSnapshot: snapshot as unknown as Record<string, unknown>,
    }).catch(() => {})
    onEvent({
      type: 'chat-meta-changed',
      projectSlug,
      chatId,
      patch: { prefixSnapshot: snapshot },
    })
  }

  const mentionsText = formatMentionsAsText(mentions)
  const finalModelMessages = mentionsText
    ? injectContextIntoLastUserMessage(modelMessages, `Context:\n${mentionsText}`)
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
    standalone: input.standalone,
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

  const handleHarnessEvent = (event: HarnessEvent): void => {
    if (
      event.type === 'subagent-start' ||
      event.type === 'subagent-result' ||
      event.type === 'subagent-event'
    ) {
      persistSubagentHarnessEvent(projectSlug, chatId, event).catch((error) => {
        toast.error('Failed to save subagent event', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    if (event.type === 'pending-subagent') {
      persistPendingSubagent(projectSlug, chatId, event).catch((error) => {
        toast.error('Failed to save pending subagent', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    }
    onEvent(event)
  }

  const sessionAllows = new Set<string>()
  const sessionDenies = new Set<string>()

  const allTools = buildTools({
    projectRoot,
    projectSlug,
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
    onPendingApproval: (entry) => {
      onEvent({
        type: 'tool-pending-approval',
        toolCallId: entry.toolCallId,
        name: entry.name,
        kind: entry.kind,
        title: entry.title,
        detail: entry.detail,
        unsandboxed: entry.unsandboxed,
        allowedScopes: entry.allowedScopes,
        diff: entry.diff ?? [],
        subagentId: entry.subagentId,
        subagentLabel: entry.subagentLabel,
      })
    },
    persistPermission: input.persistPermission,
    onHarnessEvent: handleHarnessEvent,
    signal,
  })
  const tools = filterToolsForMode(mode, allTools, {
    awaitingPlanGo: Boolean(planSession.awaitingPlanGo),
  })

  const steps = createStreamSteps({ projectSlug, chatId, onEvent })

  return {
    model,
    system,
    finalModelMessages,
    tools,
    callModel,
    callOptions,
    steps,
    projectSlug,
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
