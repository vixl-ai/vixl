import type { UIMessage } from 'ai'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import type { ContextMention } from '@/types/harness/context-mention'
import type { ContextBudget } from '@/types/harness/context-budget'
import type { ContextBucket, ContextBucketId } from '@/types/harness/context-bucket'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import { CONTEXT_BUCKET_META, CONTEXT_BUCKET_ORDER } from '@/types/harness/context-bucket-meta'
import estimateTextTokens from '@/utils/estimate-text-tokens'
import assembleSystemPromptParts, {
  formatMentionsAsText,
  type SystemPromptParts,
} from '@/services/context/system-prompt-parts'
import filterMessagesForActiveContext, {
  type ActiveContextSlice,
} from '@/services/context/filter-messages-for-active-context'
import serializeTimelineForBudget from '@/services/context/serialize-timeline-for-budget'
import estimateBuiltinToolDefinitionTokens from '@/services/context/estimate-builtin-tool-definition-tokens'
import { partsFromFrozenPrefix } from '@/services/harness/prefix-contract'
import { migrateMcpConfig, isMcpServerEnabled } from '@/schemas/mcp-config'
import { listUserMcpServers, type EffectiveMcpServer } from '@/services/mcp/merge-mcp-config'
import { mcpListStatuses, readMcpConfig } from '@/services/vixl/vixl-tauri'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'
import {
  resolveContextWindow,
  resolveModelCallOptions,
  DEFAULT_MAX_OUTPUT_TOKENS,
  FALLBACK_CONTEXT_WINDOW,
} from '@/services/models/resolve-model-call-options'
import lookupTokenlensContext from '@/services/models/lookup-tokenlens-context'

export type CountContextBudgetInput = {
  modelId: string
  providerId?: string
  settings?: VixlSettings
  mode: VixlChatMode
  projectName: string
  projectRoot: string
  mentions: ContextMention[]
  messages: UIMessage[]
  timeline?: ChatTimelineItem[]
  agentCatalog?: Array<{ name: string; description: string }>
  standalone?: boolean
  parts?: SystemPromptParts
  frozenSnapshot?: PrefixSnapshot | null
  activeContext?: ActiveContextSlice | null
}

const resolveContextLimit = (
  modelId: string,
  providerId?: string,
  settings?: VixlSettings,
): number => {
  if (providerId && settings) {
    return resolveContextWindow(settings, { providerId, modelId })
  }
  return lookupTokenlensContext(modelId) ?? FALLBACK_CONTEXT_WINDOW
}

const resolveReservedOutput = (
  modelId: string,
  providerId?: string,
  settings?: VixlSettings,
): number => {
  if (providerId && settings) {
    const options = resolveModelCallOptions(settings, { providerId, modelId })
    if (typeof options.maxOutputTokens === 'number' && options.maxOutputTokens > 0) {
      return options.maxOutputTokens
    }
  }
  return DEFAULT_MAX_OUTPUT_TOKENS
}

const serializeMessages = (messages: UIMessage[], checkpointText: string): string => {
  const body = messages
    .map((message) =>
      message.parts
        .map((part) => {
          if (part.type === 'text' || part.type === 'reasoning') {
            return part.text
          }
          return JSON.stringify(part)
        })
        .join('\n'),
    )
    .join('\n\n')

  if (!checkpointText) {
    return body
  }
  if (!body) {
    return checkpointText
  }
  return `${checkpointText}\n\n${body}`
}

const serializeConversation = (input: CountContextBudgetInput): string => {
  const { messages, checkpointText } = filterMessagesForActiveContext(
    input.messages,
    input.activeContext,
  )

  if (input.timeline && input.timeline.length > 0) {
    return serializeTimelineForBudget({
      timeline: input.timeline,
      checkpointText,
      includeFromCreatedAt: input.activeContext?.includeFromCreatedAt,
    })
  }

  return serializeMessages(messages, checkpointText)
}

const estimateMcpSchemasFromStaticConfig = (
  servers: EffectiveMcpServer[],
): number => {
  let total = 0
  for (const server of servers) {
    total += estimateTextTokens(server.id)
    const { config } = server
    if (isMcpStdioServer(config)) {
      total += estimateTextTokens(config.command)
      if (config.args && config.args.length > 0) {
        total += estimateTextTokens(config.args.join(' '))
      }
    } else if (isMcpHttpServer(config)) {
      total += estimateTextTokens(config.url)
    }
  }
  return total
}

const estimateMcpToolSchemas = async (
  projectRoot: string,
  standalone?: boolean,
): Promise<number> => {
  try {
    const personal = migrateMcpConfig(await readMcpConfig('personal', null))
    const project = standalone
      ? null
      : await readMcpConfig('project', projectRoot)
          .then((raw) => migrateMcpConfig(raw))
          .catch(() => null)
    const servers = listUserMcpServers(personal, project).filter((server) =>
      isMcpServerEnabled(server.config),
    )

    let bulkStatuses: Awaited<ReturnType<typeof mcpListStatuses>> = {}
    try {
      bulkStatuses = await mcpListStatuses()
    } catch {
      // Live tool lists are unavailable. Count enabled servers from static
      // config (id, command/url, optional description or inline tools).
      return estimateMcpSchemasFromStaticConfig(servers)
    }

    let total = 0
    for (const server of servers) {
      const state = bulkStatuses[server.id]
      if (!state) {
        continue
      }
      for (const tool of state.tools) {
        const schema = tool.inputSchema ? JSON.stringify(tool.inputSchema) : ''
        total +=
          estimateTextTokens(tool.name) +
          estimateTextTokens(tool.description ?? '') +
          estimateTextTokens(schema)
      }
    }
    return total
  } catch {
    // Last resort: MCP schema tokens stay 0 rather than failing the budget.
    return 0
  }
}

const buildBucket = (id: ContextBucketId, tokens: number): ContextBucket => ({
  id,
  label: CONTEXT_BUCKET_META[id].label,
  tokens,
})

const resolveParts = async (input: CountContextBudgetInput): Promise<SystemPromptParts> => {
  if (input.parts) {
    return input.parts
  }
  if (input.frozenSnapshot) {
    return partsFromFrozenPrefix(input.frozenSnapshot)
  }
  return assembleSystemPromptParts({
    mode: input.mode,
    projectName: input.projectName,
    projectRoot: input.projectRoot,
    mentions: input.mentions,
    agentCatalog: input.agentCatalog ?? [],
    standalone: input.standalone,
  })
}

const resolveMentionsTokens = (
  parts: SystemPromptParts,
  mentions: ContextMention[],
): number => {
  const injected = formatMentionsAsText(mentions)
  if (injected) {
    return estimateTextTokens(`Context:\n${injected}`)
  }
  return estimateTextTokens(parts.mentions)
}

export default async (input: CountContextBudgetInput): Promise<ContextBudget> => {
  const parts = await resolveParts(input)

  const builtinToolSchemas = estimateBuiltinToolDefinitionTokens(
    input.mode,
    input.settings,
  )
  const mcpToolSchemas = await estimateMcpToolSchemas(
    input.projectRoot,
    input.standalone,
  )

  // System includes the tools hint that is part of instructions.
  // Tools / MCP buckets count real definition schemas (not that hint again).
  // Conversation prefers timeline serialization so tool args/results count;
  // chatStore.messages only keep assistant text/reasoning.
  const bucketTokens: Record<ContextBucketId, number> = {
    system: estimateTextTokens(parts.base) + estimateTextTokens(parts.tools),
    tools: builtinToolSchemas,
    mcp: estimateTextTokens(parts.mcp) + mcpToolSchemas,
    rules: estimateTextTokens(parts.rules) + estimateTextTokens(parts.agentsMd),
    skills: estimateTextTokens(parts.skills),
    mentions: resolveMentionsTokens(parts, input.mentions),
    subagentDefinitions: estimateTextTokens(parts.subagents),
    messages: estimateTextTokens(serializeConversation(input)),
  }

  const buckets = CONTEXT_BUCKET_ORDER.map((id) => buildBucket(id, bucketTokens[id]))
  const promptUsed = buckets.reduce((sum, bucket) => sum + bucket.tokens, 0)
  const limit = resolveContextLimit(input.modelId, input.providerId, input.settings)
  const reservedOutput = resolveReservedOutput(input.modelId, input.providerId, input.settings)
  const safetyBuffer = Math.min(2000, Math.floor(limit * 0.02))
  const usablePrompt = limit - reservedOutput - safetyBuffer
  const free = Math.max(0, usablePrompt - promptUsed)

  return {
    modelId: input.modelId,
    promptUsed,
    used: promptUsed,
    limit,
    reservedOutput,
    safetyBuffer,
    free,
    buckets,
  }
}
