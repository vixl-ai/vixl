import { getCachedAgentHarness } from '@/composables/agent-harness/cache'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { PermissionLevel } from '@/types/harness/permission'
import type { AgentThreadViewState } from './types'

type CachedPermissionHarness = {
  markDisposed: () => void
  dispose: () => Promise<void>
  sessionPermissionLevel?: { value: PermissionLevel | null }
  permissionLevelFromSettings?: { value: boolean }
  setPermissionLevel?: (level: PermissionLevel | null) => void
}

export const isPermissionLevel = (value: unknown): value is PermissionLevel =>
  value === 'ask' || value === 'allowlist' || value === 'bypass'

export type ChatPermissionResolution =
  | { source: 'cache'; level: PermissionLevel }
  | { source: 'meta'; level: PermissionLevel }
  | { source: 'unset' }

export const resolveChatPermissionLevel = (input: {
  cachedLevel: unknown
  metaLevel: unknown
  cachedFromSettings?: boolean
}): ChatPermissionResolution => {
  const cached = isPermissionLevel(input.cachedLevel) ? input.cachedLevel : null
  const meta = isPermissionLevel(input.metaLevel) ? input.metaLevel : null
  if (cached && meta && cached !== meta && input.cachedFromSettings) {
    return { source: 'meta', level: meta }
  }
  if (cached) {
    return { source: 'cache', level: cached }
  }
  if (meta) {
    return { source: 'meta', level: meta }
  }
  return { source: 'unset' }
}

export const cachedHarnessPermissionLevel = (
  projectSlug: string,
  chatId: string,
): PermissionLevel | null => {
  const cached = readCachedPermissionHarness(projectSlug, chatId)
  return cached.level
}

const readCachedPermissionHarness = (
  projectSlug: string,
  chatId: string,
): { level: PermissionLevel | null; fromSettings: boolean } => {
  const cached = getCachedAgentHarness<CachedPermissionHarness>(projectSlug, chatId)
  const level = cached?.sessionPermissionLevel?.value
  return {
    level: isPermissionLevel(level) ? level : null,
    fromSettings: cached?.permissionLevelFromSettings?.value === true,
  }
}

export const metaPermissionLevelForChat = (
  meta: ChatMeta | null | undefined,
  chatId: string,
): PermissionLevel | null => {
  if (!meta || meta.id !== chatId) {
    return null
  }
  return isPermissionLevel(meta.permissionLevel) ? meta.permissionLevel : null
}

export const settingsMayApplyPermissionLevel = (input: {
  touched: boolean
  cachedLevel: unknown
  metaLevel: unknown
  seededLevel?: unknown
}): boolean => {
  if (input.touched) {
    return false
  }
  if (isPermissionLevel(input.metaLevel)) {
    return false
  }
  return true
}

type SettingsPermissionSeed = {
  projectSlug: string
  chatId: string
  level: PermissionLevel
}

const settingsPermissionSeeds = new WeakMap<AgentThreadViewState, SettingsPermissionSeed>()

export const settingsPermissionSeedLevel = (
  state: AgentThreadViewState,
  projectSlug: string,
  chatId: string,
): PermissionLevel | null => {
  const seed = settingsPermissionSeeds.get(state)
  if (!seed || seed.projectSlug !== projectSlug || seed.chatId !== chatId) {
    return null
  }
  return seed.level
}

export const noteSettingsPermissionSeed = (
  state: AgentThreadViewState,
  projectSlug: string,
  chatId: string,
  level: PermissionLevel,
): void => {
  settingsPermissionSeeds.set(state, { projectSlug, chatId, level })
}

export const clearSettingsPermissionSeed = (state: AgentThreadViewState): void => {
  settingsPermissionSeeds.delete(state)
}

const readMetaLevel = (state: AgentThreadViewState): PermissionLevel | null => {
  const chatId = state.chatId.value
  return (
    metaPermissionLevelForChat(state.paintedSession.value?.meta.value, chatId) ??
    metaPermissionLevelForChat(state.chatStore?.meta?.value, chatId)
  )
}

export const adoptViewPermissionLevel = (
  state: AgentThreadViewState,
): ChatPermissionResolution => {
  const cached = readCachedPermissionHarness(state.projectSlug.value, state.chatId.value)
  const resolution = resolveChatPermissionLevel({
    cachedLevel: cached.level,
    metaLevel: readMetaLevel(state),
    cachedFromSettings: cached.fromSettings,
  })
  if (resolution.source === 'unset') {
    state.permissionLevelTouched.value = false
    const seeded = settingsPermissionSeedLevel(
      state,
      state.projectSlug.value,
      state.chatId.value,
    )
    state.sessionPermissionLevel.value = seeded ?? state.defaultPermissionLevel.value
    return resolution
  }
  const persisted = readMetaLevel(state)
  if (resolution.source === 'cache' && !persisted) {
    state.sessionPermissionLevel.value = resolution.level
    state.permissionLevelTouched.value = false
    return resolution
  }
  clearSettingsPermissionSeed(state)
  state.sessionPermissionLevel.value = resolution.level
  state.permissionLevelTouched.value = true
  return resolution
}

export const adoptLateMetaPermissionLevel = (state: AgentThreadViewState): void => {
  if (state.permissionLevelChosen?.value) {
    return
  }
  const metaLevel = readMetaLevel(state)
  if (!metaLevel) {
    return
  }
  clearSettingsPermissionSeed(state)
  state.sessionPermissionLevel.value = metaLevel
  state.permissionLevelTouched.value = true
  state.harness.value?.setPermissionLevel(metaLevel)
}

export const writeSettingsPermissionLevel = (
  projectSlug: string,
  chatId: string,
  level: PermissionLevel,
): void => {
  const cached = getCachedAgentHarness<CachedPermissionHarness>(projectSlug, chatId)
  cached?.setPermissionLevel?.(level)
  if (cached?.permissionLevelFromSettings) {
    cached.permissionLevelFromSettings.value = true
  }
}
