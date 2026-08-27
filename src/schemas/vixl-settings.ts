import { z } from 'zod'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import serializeModelRef from '@/utils/serialize-model-ref'
import parseModelRef from '@/utils/parse-model-ref'
import { MODEL_REF_SEPARATOR } from '@/types/models/model-ref'
import {
  customProviderSchema,
  formatCustomProviderSchemaError,
} from '@/schemas/providers/custom-provider'
import { reasoningLevelSchema } from '@/schemas/models/reasoning-level'
import { modelCatalogMetaMapSchema } from '@/schemas/models/model-catalog-meta'
import { modelCatalogOptionsMapSchema } from '@/schemas/models/model-catalog-option'

export { customProviderSchema, customProviderModelSchema } from '@/schemas/providers/custom-provider'

const themeSchema = z.enum(['light', 'dark', 'system'])
const duplicateTabBehaviorSchema = z.enum(['ask', 'open-existing', 'open-new'])

const modelRefStringSchema = z.string().min(1)
const reasoningSettingSchema = reasoningLevelSchema
const permissionCapabilitySchema = z.custom<PermissionCapabilityKey>(
  (value): value is PermissionCapabilityKey => typeof value === 'string' && value.length > 0,
)

export const vixlSettingsSchema = z
  .object({
    version: z.literal(1),
    'appearance.theme': themeSchema.optional(),
    'agent.autoApproveGlobs': z.array(z.string()).optional(),
    'agent.permissionLevel': z.enum(['ask', 'allowlist', 'bypass']).optional(),
    'agent.permissions': z
      .array(
        z.object({
          capability: permissionCapabilitySchema,
          verdict: z.enum(['allow', 'deny']),
          scope: z.enum(['workspace', 'always']),
        }),
      )
      .optional(),
    'agent.mcp.trust': z
      .array(
        z.object({
          serverId: z.string(),
          scope: z.enum(['session', 'workspace', 'always', 'never']),
          fingerprint: z.string().min(1).optional(),
        }),
      )
      .optional(),
    'agent.sandbox.enabled': z.boolean().optional(),
    'agent.sandbox.network': z.enum(['deny', 'allow']).optional(),
    'lsp.autoDownload': z.boolean().optional(),
    'workspace.trust': z
      .array(
        z.object({
          rootPath: z.string(),
          trusted: z.boolean(),
        }),
      )
      .optional(),
    'chat.autoTitle': z.boolean().optional(),
    'workbench.duplicateTabBehavior': duplicateTabBehaviorSchema.optional(),
    'models.default': modelRefStringSchema.optional(),
    'models.ask': modelRefStringSchema.optional(),
    'models.plan': modelRefStringSchema.optional(),
    'models.studio': modelRefStringSchema.optional(),
    'models.agent': modelRefStringSchema.optional(),
    'models.orchestrator': modelRefStringSchema.optional(),
    'models.subagent': modelRefStringSchema.optional(),
    'models.title': modelRefStringSchema.optional(),
    'models.compaction': modelRefStringSchema.optional(),
    'models.defaultReasoning': reasoningSettingSchema.optional(),
    'models.askReasoning': reasoningSettingSchema.optional(),
    'models.planReasoning': reasoningSettingSchema.optional(),
    'models.studioReasoning': reasoningSettingSchema.optional(),
    'models.agentReasoning': reasoningSettingSchema.optional(),
    'models.orchestratorReasoning': reasoningSettingSchema.optional(),
    'models.subagentReasoning': reasoningSettingSchema.optional(),
    'models.titleReasoning': reasoningSettingSchema.optional(),
    'models.compactionReasoning': reasoningSettingSchema.optional(),
    'models.catalogOptions': modelCatalogOptionsMapSchema.optional(),
    'models.catalogMeta': modelCatalogMetaMapSchema.optional(),
  })
  .catchall(
    z.union([
      z.string(),
      customProviderSchema,
      modelCatalogOptionsMapSchema,
      modelCatalogMetaMapSchema,
      z.number(),
      z.boolean(),
      z.array(z.unknown()),
    ]),
  )

export const validateVixlSettings = (
  settings: unknown,
): { success: true; data: VixlSettings } | { success: false; error: string } => {
  const parsed = vixlSettingsSchema.safeParse(settings)
  if (!parsed.success) {
    return {
      success: false,
      error: formatCustomProviderSchemaError(parsed.error),
    }
  }
  return { success: true, data: parsed.data as VixlSettings }
}
export const defaultVixlSettings = (): VixlSettings => ({
  version: 1,
  'appearance.theme': 'system',
  'agent.autoApproveGlobs': [],
  'agent.permissionLevel': 'allowlist',
  'agent.permissions': [],
  'agent.mcp.trust': [],
  'agent.sandbox.enabled': true,
  'agent.sandbox.network': 'deny',
  'lsp.autoDownload': true,
  'workspace.trust': [],
  'chat.autoTitle': true,
  'workbench.duplicateTabBehavior': 'ask',
})

const toModelRefString = (
  providerId: string | undefined,
  modelValue: string | undefined,
): string | undefined => {
  if (!modelValue?.trim()) {
    return undefined
  }

  const trimmed = modelValue.trim()
  if (trimmed.includes(MODEL_REF_SEPARATOR)) {
    return trimmed
  }

  if (providerId) {
    return serializeModelRef({ providerId, modelId: trimmed })
  }

  return trimmed
}

const migrateDeprecatedModelKeys = (record: Record<string, unknown>): Record<string, unknown> => {
  const next = { ...record }
  const legacyProvider =
    typeof next['agent.defaultProvider'] === 'string' ? next['agent.defaultProvider'] : undefined
  const legacyDefaultModel =
    typeof next['agent.defaultModel'] === 'string' ? next['agent.defaultModel'] : undefined
  const legacyTitleModel =
    typeof next['chat.autoTitleModel'] === 'string' ? next['chat.autoTitleModel'] : undefined

  if (!next['models.default'] && legacyDefaultModel) {
    const migrated = toModelRefString(legacyProvider, legacyDefaultModel)
    if (migrated) {
      next['models.default'] = migrated
    }
  }

  if (!next['models.title'] && legacyTitleModel) {
    const migrated = toModelRefString(legacyProvider, legacyTitleModel)
    if (migrated) {
      next['models.title'] = migrated
    }
  }

  delete next['agent.defaultProvider']
  delete next['agent.defaultModel']
  delete next['chat.autoTitleModel']
  delete next['agent.defaultMode']
  delete next['fleet.maxConcurrentAgents']
  delete next['fleet.trayBackground']
  delete next['general.machineLabel']

  return next
}

export const migrateVixlSettings = (raw: unknown): VixlSettings => {
  if (typeof raw !== 'object' || raw === null) {
    return defaultVixlSettings()
  }

  const record = raw as Record<string, unknown>
  const version = record.version

  if (version === 1) {
    const migratedRecord = migrateDeprecatedModelKeys(record)
    const parsed = vixlSettingsSchema.safeParse(migratedRecord)
    if (parsed.success) {
      return { ...defaultVixlSettings(), ...parsed.data }
    }
  }

  return defaultVixlSettings()
}

export const normalizeStoredModelRef = (
  value: string | undefined,
  legacyProviderId?: string,
): string | undefined => {
  if (!value?.trim()) {
    return undefined
  }

  const trimmed = value.trim()
  if (parseModelRef(trimmed)) {
    return trimmed
  }

  if (legacyProviderId) {
    return serializeModelRef({ providerId: legacyProviderId, modelId: trimmed })
  }

  return trimmed
}
