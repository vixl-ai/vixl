import type { ModelRoleId } from '@/data/model-role-registry'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import parseModelRef from '@/utils/parse-model-ref'

const isChatMode = (role: ModelRoleId): role is VixlChatMode =>
  role === 'ask' ||
  role === 'plan' ||
  role === 'studio' ||
  role === 'agent' ||
  role === 'orchestrator'

const readSettingsModel = (
  settings: VixlSettings,
  key: `models.${string}`,
): string | undefined => {
  const value = settings[key]
  return typeof value === 'string' ? value : undefined
}

export const resolveModelForRole = (
  role: ModelRoleId,
  settings: VixlSettings,
  chatOverride?: string,
): string | undefined => {
  if (chatOverride?.trim()) {
    return chatOverride.trim()
  }

  if (role === 'default') {
    return readSettingsModel(settings, 'models.default')
  }

  const roleKey = `models.${role}` as const
  const roleValue = readSettingsModel(settings, roleKey)
  if (roleValue) {
    return roleValue
  }

  if (role === 'subagent') {
    return (
      readSettingsModel(settings, 'models.agent') ??
      readSettingsModel(settings, 'models.default')
    )
  }

  if (isChatMode(role) || role === 'title' || role === 'compaction') {
    return readSettingsModel(settings, 'models.default')
  }

  return undefined
}

export default resolveModelForRole

export const resolveParsedModelForRole = (
  role: ModelRoleId,
  settings: VixlSettings,
  chatOverride?: string,
): ReturnType<typeof parseModelRef> => {
  const serialized = resolveModelForRole(role, settings, chatOverride)
  if (!serialized) {
    return null
  }
  return parseModelRef(serialized)
}
