import { getCachedAgentHarness } from '@/composables/agent-harness/cache'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { PermissionLevel } from '@/types/harness/permission'
import type { AgentThreadViewState } from './types'

type CachedPermissionHarness = {
  markDisposed: () => void
  dispose: () => Promise<void>
  sessionPermissionLevel?: { value: PermissionLevel | null }
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
}): ChatPermissionResolution => {
  if (isPermissionLevel(input.cachedLevel)) {
    return { source: 'cache', level: input.cachedLevel }
  }
  if (isPermissionLevel(input.metaLevel)) {
    return { source: 'meta', level: input.metaLevel }
  }
  return { source: 'unset' }
}

export const cachedHarnessPermissionLevel = (
  projectSlug: string,
  chatId: string,
): PermissionLevel | null => {
  const cached = getCachedAgentHarness<CachedPermissionHarness>(projectSlug, chatId)
  const level = cached?.sessionPermissionLevel?.value
  return isPermissionLevel(level) ? level : null
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
}): boolean => {
  if (input.touched) {
    return false
  }
  if (isPermissionLevel(input.cachedLevel)) {
    return false
  }
  if (isPermissionLevel(input.metaLevel)) {
    return false
  }
  return true
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
  const resolution = resolveChatPermissionLevel({
    cachedLevel: cachedHarnessPermissionLevel(
      state.projectSlug.value,
      state.chatId.value,
    ),
    metaLevel: readMetaLevel(state),
  })
  if (resolution.source === 'unset') {
    state.permissionLevelTouched.value = false
    state.sessionPermissionLevel.value = state.defaultPermissionLevel.value
    return resolution
  }
  state.sessionPermissionLevel.value = resolution.level
  state.permissionLevelTouched.value = true
  return resolution
}

export const adoptLateMetaPermissionLevel = (state: AgentThreadViewState): void => {
  if (state.permissionLevelTouched.value) {
    return
  }
  const metaLevel = readMetaLevel(state)
  if (!metaLevel) {
    return
  }
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
  if (isPermissionLevel(cached?.sessionPermissionLevel?.value)) {
    return
  }
  cached?.setPermissionLevel?.(level)
}
