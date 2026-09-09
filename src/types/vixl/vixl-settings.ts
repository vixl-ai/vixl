import type { McpTrustRecord, PermissionLevel, PermissionRecord } from '@/types/harness/permission'
import type { ModelCatalogMetaMap } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOptionsMap } from '@/types/models/model-catalog-option'
import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

export type VixlTheme = 'light' | 'dark' | 'system'

export type VixlChatMode = 'ask' | 'plan' | 'agent' | 'orchestrator'

export type VixlDuplicateTabBehavior = 'ask' | 'open-existing' | 'open-new'

export type VixlCustomProviderModel = {
  id: string
  name?: string
  maxInputTokens?: number
  maxOutputTokens?: number
  contextWindow?: number
  toolCalling?: boolean
  vision?: boolean
  thinking?: boolean
  streaming?: boolean
  supportsReasoningEffort?: string[]
  reasoningEffort?: string
  temperature?: number
  topP?: number
  topK?: number
  frequencyPenalty?: number
  presencePenalty?: number
  seed?: number
  headers?: Record<string, string>
  modelOptions?: Record<string, unknown>
  pricing?: ModelPricingRates
}

export type VixlCustomProvider = {
  type: 'openai-compatible'
  baseURL: string
  apiKeyRef?: string
  name: string
  headers?: Record<string, string>
  queryParams?: Record<string, string>
  includeUsage?: boolean
  supportsStructuredOutputs?: boolean
  models?: VixlCustomProviderModel[]
}

export type VixlSettings = {
  version: 1
  'appearance.theme'?: VixlTheme
  // Personal-only: active custom theme id (built-in fallback when missing)
  // and the saved/imported theme library. Stripped from project overrides.
  'appearance.activeThemeId'?: string
  'appearance.themeLibrary'?: VixlThemeDefinition[]
  'agent.autoApproveGlobs'?: string[]
  'agent.permissionLevel'?: PermissionLevel
  'agent.permissions'?: PermissionRecord[]
  'agent.mcp.trust'?: McpTrustRecord[]
  'agent.sandbox.enabled'?: boolean
  'agent.sandbox.network'?: 'deny' | 'allow'
  'lsp.autoDownload'?: boolean
  'workspace.trust'?: Array<{ rootPath: string; trusted: boolean }>
  'chat.autoTitle'?: boolean
  'workbench.duplicateTabBehavior'?: VixlDuplicateTabBehavior
  'models.default'?: string
  'models.ask'?: string
  'models.plan'?: string
  'models.agent'?: string
  'models.orchestrator'?: string
  'models.subagent'?: string
  'models.title'?: string
  'models.defaultReasoning'?: string
  'models.askReasoning'?: string
  'models.planReasoning'?: string
  'models.agentReasoning'?: string
  'models.orchestratorReasoning'?: string
  'models.subagentReasoning'?: string
  'models.titleReasoning'?: string
  'models.catalogOptions'?: ModelCatalogOptionsMap
  'models.catalogMeta'?: ModelCatalogMetaMap
  [key: `providers.${string}.apiKeyRef`]: string | undefined
  [key: `providers.custom.${string}`]: VixlCustomProvider | undefined
  // String model refs and reasoning levels. catalogOptions and catalogMeta are
  // declared above and must stay compatible with this index (object values
  // allowed for those keys only).
  [key: `models.${string}`]: string | ModelCatalogOptionsMap | ModelCatalogMetaMap | undefined
}
