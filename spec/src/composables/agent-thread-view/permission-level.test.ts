import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import type { ChatMeta } from '@/types/chat/chat-meta'

const getCachedAgentHarness = vi.hoisted(() =>
  vi.fn<(projectSlug: string, chatId: string) => unknown>(),
)

vi.mock('@/composables/agent-harness/cache', () => ({
  getCachedAgentHarness: (...args: [string, string]) =>
    getCachedAgentHarness(...args),
}))

import {
  adoptLateMetaPermissionLevel,
  adoptViewPermissionLevel,
  resolveChatPermissionLevel,
  settingsMayApplyPermissionLevel,
  writeSettingsPermissionLevel,
} from '@/composables/agent-thread-view/permission-level'
import { mapMeta } from '@/composables/chat-store/helpers'

const metaFor = (id: string, permissionLevel?: ChatMeta['permissionLevel']): ChatMeta => ({
  id,
  title: id,
  projectSlug: 'proj',
  projectRoot: '/proj',
  mode: 'agent',
  model: 'test/model',
  status: 'idle',
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
  ...(permissionLevel ? { permissionLevel } : {}),
})

describe('resolveChatPermissionLevel', () => {
  it('prefers a cached harness level over meta', () => {
    expect(
      resolveChatPermissionLevel({
        cachedLevel: 'allowlist',
        metaLevel: 'bypass',
      }),
    ).toEqual({ source: 'cache', level: 'allowlist' })
  })

  it('uses meta when the cache has no level', () => {
    expect(
      resolveChatPermissionLevel({
        cachedLevel: null,
        metaLevel: 'ask',
      }),
    ).toEqual({ source: 'meta', level: 'ask' })
  })

  it('is unset when neither cache nor meta has a level', () => {
    expect(
      resolveChatPermissionLevel({
        cachedLevel: null,
        metaLevel: undefined,
      }),
    ).toEqual({ source: 'unset' })
  })

  it('treats invalid values as missing', () => {
    expect(
      resolveChatPermissionLevel({
        cachedLevel: 'nope',
        metaLevel: 'also-nope',
      }),
    ).toEqual({ source: 'unset' })
  })
})

describe('settingsMayApplyPermissionLevel', () => {
  it('blocks settings when the chat already adopted a level', () => {
    expect(
      settingsMayApplyPermissionLevel({
        touched: true,
        cachedLevel: null,
        metaLevel: null,
      }),
    ).toBe(false)
  })

  it('does not treat an unpersisted harness level as a saved choice', () => {
    expect(
      settingsMayApplyPermissionLevel({
        touched: false,
        cachedLevel: 'allowlist',
        metaLevel: null,
      }),
    ).toBe(true)
  })

  it('blocks settings when this chat meta has a level', () => {
    expect(
      settingsMayApplyPermissionLevel({
        touched: false,
        cachedLevel: null,
        metaLevel: 'ask',
      }),
    ).toBe(false)
  })

  it('allows settings only when the chat still has no own level', () => {
    expect(
      settingsMayApplyPermissionLevel({
        touched: false,
        cachedLevel: null,
        metaLevel: null,
      }),
    ).toBe(true)
  })
})

describe('adoptViewPermissionLevel', () => {
  beforeEach(() => {
    getCachedAgentHarness.mockReset()
    getCachedAgentHarness.mockReturnValue(undefined)
  })

  const buildState = (overrides?: {
    chatId?: string
    cachedLevel?: 'ask' | 'allowlist' | 'bypass' | null
    meta?: ChatMeta | null
    defaultLevel?: 'ask' | 'allowlist' | 'bypass'
    sessionLevel?: 'ask' | 'allowlist' | 'bypass'
    touched?: boolean
  }): AgentThreadViewState => {
    if (overrides?.cachedLevel) {
      getCachedAgentHarness.mockReturnValue({
        sessionPermissionLevel: { value: overrides.cachedLevel },
      })
    }
    const chatId = overrides?.chatId ?? 'chat-1'
    return {
      projectSlug: computed(() => 'proj'),
      chatId: computed(() => chatId),
      paintedSession: shallowRef({
        meta: computed(() => overrides?.meta ?? null),
      }),
      chatStore: {
        meta: computed(() => null),
      },
      defaultPermissionLevel: computed(() => overrides?.defaultLevel ?? 'bypass'),
      sessionPermissionLevel: ref(overrides?.sessionLevel ?? 'bypass'),
      permissionLevelTouched: ref(overrides?.touched ?? true),
      harness: shallowRef(null),
    } as unknown as AgentThreadViewState
  }

  it('copies a cached harness level onto the dial without locking settings', () => {
    const state = buildState({ cachedLevel: 'allowlist' })
    const resolution = adoptViewPermissionLevel(state)
    expect(resolution).toEqual({ source: 'cache', level: 'allowlist' })
    expect(state.sessionPermissionLevel.value).toBe('allowlist')
    expect(state.permissionLevelTouched.value).toBe(false)
  })

  it('locks settings when the cached chat also has a stored level', () => {
    const state = buildState({
      cachedLevel: 'allowlist',
      meta: metaFor('chat-1', 'allowlist'),
    })
    const resolution = adoptViewPermissionLevel(state)
    expect(resolution).toEqual({ source: 'cache', level: 'allowlist' })
    expect(state.permissionLevelTouched.value).toBe(true)
  })

  it('adopts this chat meta when cache is empty', () => {
    const state = buildState({ meta: metaFor('chat-1', 'ask') })
    const resolution = adoptViewPermissionLevel(state)
    expect(resolution).toEqual({ source: 'meta', level: 'ask' })
    expect(state.sessionPermissionLevel.value).toBe('ask')
    expect(state.permissionLevelTouched.value).toBe(true)
  })

  it('resets touched and the dial to the settings default when unset', () => {
    const state = buildState({
      meta: metaFor('chat-1'),
      defaultLevel: 'allowlist',
      sessionLevel: 'bypass',
      touched: true,
    })
    const resolution = adoptViewPermissionLevel(state)
    expect(resolution).toEqual({ source: 'unset' })
    expect(state.sessionPermissionLevel.value).toBe('allowlist')
    expect(state.permissionLevelTouched.value).toBe(false)
  })

  it('ignores meta that belongs to a different chat', () => {
    const state = buildState({
      chatId: 'chat-b',
      meta: metaFor('chat-a', 'ask'),
      defaultLevel: 'allowlist',
      sessionLevel: 'bypass',
      touched: true,
    })
    const resolution = adoptViewPermissionLevel(state)
    expect(resolution).toEqual({ source: 'unset' })
    expect(state.permissionLevelTouched.value).toBe(false)
    expect(state.sessionPermissionLevel.value).toBe('allowlist')
  })
})

describe('adoptLateMetaPermissionLevel', () => {
  beforeEach(() => {
    getCachedAgentHarness.mockReset()
    getCachedAgentHarness.mockReturnValue(undefined)
  })

  it('applies hydrated meta when the chat still has no adopted level', () => {
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const state = {
      projectSlug: computed(() => 'proj'),
      chatId: computed(() => 'chat-1'),
      paintedSession: shallowRef({
        meta: computed(() => metaFor('chat-1', 'ask')),
      }),
      chatStore: { meta: computed(() => null) },
      permissionLevelTouched: ref(false),
      sessionPermissionLevel: ref('allowlist'),
      harness: shallowRef({ setPermissionLevel }),
    } as unknown as AgentThreadViewState

    adoptLateMetaPermissionLevel(state)

    expect(state.sessionPermissionLevel.value).toBe('ask')
    expect(state.permissionLevelTouched.value).toBe(true)
    expect(setPermissionLevel).toHaveBeenCalledWith('ask')
  })

  it('overwrites a settings-painted harness when hydrated meta arrives', () => {
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const state = {
      projectSlug: computed(() => 'proj'),
      chatId: computed(() => 'chat-1'),
      paintedSession: shallowRef({
        meta: computed(() => metaFor('chat-1', 'allowlist')),
      }),
      chatStore: { meta: computed(() => null) },
      permissionLevelTouched: ref(false),
      sessionPermissionLevel: ref('bypass'),
      harness: shallowRef({ setPermissionLevel }),
    } as unknown as AgentThreadViewState

    adoptLateMetaPermissionLevel(state)

    expect(state.sessionPermissionLevel.value).toBe('allowlist')
    expect(state.permissionLevelTouched.value).toBe(true)
    expect(setPermissionLevel).toHaveBeenCalledWith('allowlist')
  })

  it('does not apply late meta after this chat already adopted a level', () => {
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const state = {
      projectSlug: computed(() => 'proj'),
      chatId: computed(() => 'chat-1'),
      paintedSession: shallowRef({
        meta: computed(() => metaFor('chat-1', 'ask')),
      }),
      chatStore: { meta: computed(() => null) },
      permissionLevelTouched: ref(true),
      sessionPermissionLevel: ref('allowlist'),
      harness: shallowRef({ setPermissionLevel }),
    } as unknown as AgentThreadViewState

    adoptLateMetaPermissionLevel(state)

    expect(state.sessionPermissionLevel.value).toBe('allowlist')
    expect(setPermissionLevel).not.toHaveBeenCalled()
  })
})

describe('mapMeta permissionLevel', () => {
  it('keeps a stored permissionLevel on parsed chat meta', () => {
    const parsed = mapMeta({
      ...metaFor('chat-1', 'ask'),
      projectSlug: 'proj',
      projectRoot: '/proj',
    })
    expect(parsed.permissionLevel).toBe('ask')
  })

  it('allows a missing permissionLevel', () => {
    const parsed = mapMeta(metaFor('chat-1'))
    expect(parsed.permissionLevel).toBeUndefined()
  })
})

describe('writeSettingsPermissionLevel', () => {
  beforeEach(() => {
    getCachedAgentHarness.mockReset()
  })

  it('replaces an unpersisted harness level with the loaded settings level', () => {
    const setPermissionLevel = vi.fn<(level: string | null) => void>()
    getCachedAgentHarness.mockReturnValue({
      sessionPermissionLevel: { value: 'allowlist' },
      setPermissionLevel,
    })
    writeSettingsPermissionLevel('proj', 'chat-1', 'bypass')
    expect(setPermissionLevel).toHaveBeenCalledWith('bypass')
  })

  it('writes settings onto a harness with no session level', () => {
    const setPermissionLevel = vi.fn<(level: string | null) => void>()
    getCachedAgentHarness.mockReturnValue({
      sessionPermissionLevel: { value: null },
      setPermissionLevel,
    })
    writeSettingsPermissionLevel('proj', 'chat-1', 'bypass')
    expect(setPermissionLevel).toHaveBeenCalledWith('bypass')
  })

})
