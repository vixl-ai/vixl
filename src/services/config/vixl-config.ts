import type { VixlSettings } from '@/types/vixl/vixl-settings'
import {
  defaultVixlSettings,
  migrateVixlSettings,
  vixlSettingsSchema,
  validateVixlSettings,
} from '@/schemas/vixl-settings'
import {
  isPersonalOnlyProjectKey,
  mergeSettings,
  parseSettingsRecord,
  removeSectionOverrides,
  removeSettingsKeys,
  stripPersonalOnlyProjectOverrides,
} from '@/services/config/merge-settings'
import {
  readSettings,
  writeSettings,
  type ConfigScope,
} from '@/services/vixl/vixl-tauri'

export type VixlConfigScope = ConfigScope | 'effective'

const toSettings = (raw: Record<string, unknown>): VixlSettings => {
  const migrated = migrateVixlSettings(raw)
  return { ...defaultVixlSettings(), ...parseSettingsRecord(migrated as Record<string, unknown>) }
}

export const parseProjectOverrides = (record: Record<string, unknown>): VixlSettings => {
  const overrideKeys = Object.keys(record).filter((key) => key !== 'version')
  if (overrideKeys.length === 0) {
    return { version: 1 }
  }

  const parsed = vixlSettingsSchema.safeParse(record)
  if (!parsed.success) {
    return { version: 1 }
  }

  const settings: VixlSettings = { version: 1 }

  for (const key of overrideKeys) {
    if (isPersonalOnlyProjectKey(key)) {
      continue
    }
    const value = parsed.data[key as keyof typeof parsed.data]
    if (value !== undefined) {
      ;(settings as Record<string, unknown>)[key] = value
    }
  }

  return settings
}

export const loadPersonalSettings = async (): Promise<VixlSettings> => {
  const raw = await readSettings('personal')
  return toSettings(raw)
}

export const loadProjectSettings = async (rootPath: string): Promise<VixlSettings> => {
  const raw = (await readSettings('project', rootPath)) as Record<string, unknown>
  const hadPersonalOnlyKeys = Object.keys(raw).some(
    (key) => key !== 'version' && isPersonalOnlyProjectKey(key),
  )
  const stripped = parseProjectOverrides(raw)
  if (hadPersonalOnlyKeys) {
    await saveSettings('project', stripped, rootPath)
  }
  return stripped
}

export const loadEffectiveSettings = async (
  rootPath: string | null,
): Promise<VixlSettings> => {
  const personal = await loadPersonalSettings()
  if (!rootPath) {
    return personal
  }
  const project = await loadProjectSettings(rootPath)
  return mergeSettings(personal, project)
}

export const saveSettings = async (
  scope: ConfigScope,
  settings: VixlSettings,
  rootPath?: string | null,
): Promise<void> => {
  const toSave =
    scope === 'project' ? stripPersonalOnlyProjectOverrides(settings) : settings
  const validated = validateVixlSettings(toSave)
  if (!validated.success) {
    throw new Error(`Invalid settings: ${validated.error}`)
  }
  await writeSettings(scope, validated.data as Record<string, unknown>, rootPath)
}

export const resetSettingsKeys = async (
  scope: ConfigScope,
  keys: string[],
  settings: VixlSettings,
  rootPath?: string | null,
): Promise<VixlSettings> => {
  const next = removeSettingsKeys(settings, keys)
  await saveSettings(scope, next, rootPath)
  return scope === 'project' ? stripPersonalOnlyProjectOverrides(next) : next
}

export const resetSettingsSection = async (
  scope: ConfigScope,
  sectionPrefix: string,
  settings: VixlSettings,
  rootPath?: string | null,
): Promise<VixlSettings> => {
  const next = removeSectionOverrides(settings, sectionPrefix)
  await saveSettings(scope, next, rootPath)
  return scope === 'project' ? stripPersonalOnlyProjectOverrides(next) : next
}

export const isProjectOverride = (project: VixlSettings, key: string): boolean =>
  key in project && key !== 'version'
