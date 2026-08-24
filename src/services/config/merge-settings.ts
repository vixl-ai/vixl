import type {
  McpTrustRecord,
  PermissionRecord,
} from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { defaultVixlSettings } from '@/schemas/vixl-settings'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * Union personal + project records by identity key.
 * Personal is the base; project overlays same-key entries via resolveConflict.
 */
export const mergeKeyedSettingRecords = <T>(
  personal: readonly T[],
  project: readonly T[],
  getKey: (record: T) => string,
  resolveConflict: (personalRecord: T, projectRecord: T) => T,
): T[] => {
  const byKey = new Map<string, T>()

  for (const record of personal) {
    const key = getKey(record)
    if (!key) {
      continue
    }
    byKey.set(key, record)
  }

  for (const record of project) {
    const key = getKey(record)
    if (!key) {
      continue
    }
    const existing = byKey.get(key)
    byKey.set(key, existing ? resolveConflict(existing, record) : record)
  }

  return [...byKey.values()]
}

const resolveMcpTrustConflict = (
  personalRecord: McpTrustRecord,
  projectRecord: McpTrustRecord,
): McpTrustRecord => {
  if (personalRecord.scope === 'never') {
    return personalRecord
  }
  if (projectRecord.scope === 'never') {
    return projectRecord
  }
  return projectRecord
}

const resolvePermissionConflict = (
  personalRecord: PermissionRecord,
  projectRecord: PermissionRecord,
): PermissionRecord => {
  if (personalRecord.verdict === 'deny') {
    return personalRecord
  }
  if (projectRecord.verdict === 'deny') {
    return projectRecord
  }
  return projectRecord
}

const isMcpTrustRecordArray = (value: unknown): value is McpTrustRecord[] =>
  Array.isArray(value)

const isPermissionRecordArray = (value: unknown): value is PermissionRecord[] =>
  Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const unionStringArrays = (
  personal: string[] | undefined,
  project: string[],
): string[] => {
  const seen = new Set<string>()
  const next: string[] = []
  for (const entry of [...(personal ?? []), ...project]) {
    if (seen.has(entry)) {
      continue
    }
    seen.add(entry)
    next.push(entry)
  }
  return next
}

export const mergeSettings = (
  personal: VixlSettings,
  project: VixlSettings | null,
): VixlSettings => {
  const base = { ...defaultVixlSettings(), ...personal, version: 1 as const }

  if (!project) {
    return base
  }

  const merged: VixlSettings = { ...base }

  for (const [key, value] of Object.entries(project)) {
    if (key === 'version') {
      continue
    }
    if (value === undefined) {
      continue
    }

    if (key === 'agent.mcp.trust' && isMcpTrustRecordArray(value)) {
      merged['agent.mcp.trust'] = mergeKeyedSettingRecords(
        base['agent.mcp.trust'] ?? [],
        value,
        (record) => record.serverId,
        resolveMcpTrustConflict,
      )
      continue
    }

    if (key === 'agent.permissions' && isPermissionRecordArray(value)) {
      merged['agent.permissions'] = mergeKeyedSettingRecords(
        base['agent.permissions'] ?? [],
        value,
        (record) => record.capability,
        resolvePermissionConflict,
      )
      continue
    }

    if (key === 'agent.autoApproveGlobs' && isStringArray(value)) {
      merged['agent.autoApproveGlobs'] = unionStringArrays(
        base['agent.autoApproveGlobs'],
        value,
      )
      continue
    }

    ;(merged as Record<string, unknown>)[key] = value
  }

  return merged
}

export const removeSettingsKeys = (
  settings: VixlSettings,
  keys: string[],
): VixlSettings => {
  const next = { ...settings }

  for (const key of keys) {
    delete (next as Record<string, unknown>)[key]
  }

  return next
}

export const PERSONAL_ONLY_PROJECT_KEY_PREFIXES = ['providers.', 'models.', 'lsp.'] as const

export const isPersonalOnlyProjectKey = (key: string): boolean =>
  PERSONAL_ONLY_PROJECT_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))

export const stripPersonalOnlyProjectOverrides = (
  settings: VixlSettings,
): VixlSettings => {
  const next: VixlSettings = { version: 1 }

  for (const [key, value] of Object.entries(settings)) {
    if (key === 'version') {
      continue
    }
    if (isPersonalOnlyProjectKey(key)) {
      continue
    }
    ;(next as Record<string, unknown>)[key] = value
  }

  return next
}

export const removeSectionOverrides = (
  settings: VixlSettings,
  sectionPrefix: string,
): VixlSettings => {
  const next: VixlSettings = { version: 1 }
  const prefixes =
    sectionPrefix === 'providers'
      ? ['providers.']
      : sectionPrefix === 'models'
        ? ['models.']
        : [`${sectionPrefix}.`]

  for (const [key, value] of Object.entries(settings)) {
    if (key === 'version') {
      continue
    }
    const matches = prefixes.some((prefix) => key.startsWith(prefix) || key === prefix)
    if (!matches) {
      ;(next as Record<string, unknown>)[key] = value
    }
  }

  return next
}

export const parseSettingsRecord = (record: Record<string, unknown>): VixlSettings => {
  const settings: VixlSettings = { version: 1 }

  for (const [key, value] of Object.entries(record)) {
    if (key === 'version') {
      continue
    }
    if (value === undefined || value === null) {
      continue
    }
    if (key.startsWith('providers.custom.') && isPlainObject(value)) {
      ;(settings as Record<string, unknown>)[key] = value
      continue
    }
    ;(settings as Record<string, unknown>)[key] = value
  }

  return settings
}
