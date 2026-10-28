import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import { setPendingChatMessage } from '@/services/chat/pending-message'
import type { ChatMetaRecord } from '@/services/vixl/vixl-tauri/types'

vi.mock('@/composables/use-agent-harness', () => ({
  default: vi.fn<() => unknown>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () => ({
  getUserHomeDir: vi.fn<() => Promise<string>>(),
  updateChatMeta: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  setSubagentModelLock: vi.fn<(...args: unknown[]) => void>(),
}))

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import useAgentHarness from '@/composables/use-agent-harness'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'

const savedChatMeta = (): ChatMetaRecord => ({
  id: 'chat-1',
  title: 'Chat',
  projectSlug: 'proj',
  projectRoot: '/tmp/proj',
  mode: 'agent',
  model: 'test',
  status: 'idle',
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
})

describe('createSessionOps flushPendingChatMessage', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(updateChatMeta).mockReset()
    vi.mocked(updateChatMeta).mockResolvedValue(savedChatMeta())
    toastError.mockClear()
  })

  it('passes pending files and mentions to send', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')

    const send = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const refreshSlug = vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined)
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const draftMentions = ref<ContextMention[]>([])

    const files: FileUIPart[] = [
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'data:image/png;base64,abc',
        filename: 'element.png',
      },
    ]
    const mentions: ContextMention[] = [
      {
        type: 'file',
        path: 'src/utils/foo.ts',
      },
    ]

    setPendingChatMessage({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      files,
      mentions,
    })

    const state = {
      isSubagentView: computed(() => false),
      harness: shallowRef({
        send,
        setPermissionLevel,
      }),
      permissionLevelTouched: ref(false),
      sessionPermissionLevel: ref('ask'),
      projectSlug: computed(() => 'home'),
      chatId: computed(() => 'chat-1'),
      contextBudgetSync: {
        draftMentions,
      },
      fleetSidebar: {
        refreshSlug,
      },
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.flushPendingChatMessage()

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      reasoning: undefined,
      mentions,
      files,
    })
    expect(refreshSlug).toHaveBeenCalledWith('home')
    expect(updateChatMeta).not.toHaveBeenCalled()
  })

  it('persists pending permissionLevel on the chat and keeps the session level if save fails', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    vi.mocked(updateChatMeta).mockReset()
    vi.mocked(updateChatMeta).mockRejectedValueOnce(new Error('disk full'))
    toastError.mockClear()

    const send = vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined)
    const setPermissionLevel = vi.fn<(level: string) => void>()
    const patchMeta = vi.fn<(patch: { permissionLevel: string }) => void>()

    setPendingChatMessage({
      text: 'Inspect this',
      mode: 'agent',
      model: 'openai/gpt-4o',
      permissionLevel: 'bypass',
    })

    const state = {
      isSubagentView: computed(() => false),
      harness: shallowRef({
        send,
        setPermissionLevel,
      }),
      permissionLevelTouched: ref(false),
      sessionPermissionLevel: ref('ask'),
      projectSlug: computed(() => 'home'),
      chatId: computed(() => 'chat-1'),
      contextBudgetSync: {
        draftMentions: ref([]),
      },
      fleetSidebar: {
        refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
      },
      paintedSession: shallowRef({ patchMeta }),
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.flushPendingChatMessage()

    expect(state.permissionLevelTouched.value).toBe(true)
    expect(state.sessionPermissionLevel.value).toBe('bypass')
    expect(setPermissionLevel).toHaveBeenCalledWith('bypass')
    expect(updateChatMeta).toHaveBeenCalledWith('home', 'chat-1', {
      permissionLevel: 'bypass',
    })
    expect(toastError).toHaveBeenCalledWith('Failed to save permission level', {
      description: 'disk full',
    })
    expect(patchMeta).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledTimes(1)
  })
})

describe('createSessionOps initHarness', () => {
  const harnessState = (overrides?: {
    cachedLevel?: 'ask' | 'allowlist' | 'bypass' | null
    cachedFromSettings?: boolean
    metaLevel?: 'ask' | 'allowlist' | 'bypass'
    sessionLevel?: 'ask' | 'allowlist' | 'bypass'
    touched?: boolean
  }) => {
    const restoreUsageLedger = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise(() => {}))
    const restorePendingApprovals = vi.fn<() => void>()
    const setPermissionLevel = vi.fn<(level: string) => void>()
    vi.mocked(useAgentHarness).mockReturnValue({
      restoreUsageLedger,
      restorePendingApprovals,
      setPermissionLevel,
      sessionPermissionLevel: ref(overrides?.cachedLevel ?? null),
      permissionLevelFromSettings: ref(overrides?.cachedFromSettings === true),
    } as unknown as ReturnType<typeof useAgentHarness>)

    const chatId = 'chat-1'
    const state = {
      chatId: computed(() => chatId),
      projectSlug: computed(() => 'proj'),
      isStandalone: computed(() => false),
      sessionPermissionLevel: ref(overrides?.sessionLevel ?? 'bypass'),
      defaultPermissionLevel: computed(() => 'bypass' as const),
      permissionLevelTouched: ref(overrides?.touched ?? false),
      paintedSession: shallowRef({
        meta: computed(() =>
          overrides?.metaLevel
            ? {
                id: chatId,
                permissionLevel: overrides.metaLevel,
              }
            : null,
        ),
      }),
      chatStore: { meta: computed(() => null) },
      harness: shallowRef(null),
    } as unknown as AgentThreadViewState

    return { state, setPermissionLevel, restorePendingApprovals, restoreUsageLedger }
  }

  it('starts usage restore without awaiting it on the paint path', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, restorePendingApprovals, restoreUsageLedger, setPermissionLevel } =
      harnessState()

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(restorePendingApprovals).toHaveBeenCalledTimes(1)
    expect(restoreUsageLedger).toHaveBeenCalledTimes(1)
    expect(setPermissionLevel).toHaveBeenCalledWith('bypass')
  })

  it('does not overwrite a cached harness level with the view default', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, setPermissionLevel } = harnessState({
      cachedLevel: 'allowlist',
      sessionLevel: 'bypass',
    })

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(setPermissionLevel).not.toHaveBeenCalled()
    expect(state.sessionPermissionLevel.value).toBe('allowlist')
    expect(state.permissionLevelTouched.value).toBe(false)
  })

  it('replaces a settings-seeded harness with stored meta', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, setPermissionLevel } = harnessState({
      cachedLevel: 'bypass',
      cachedFromSettings: true,
      metaLevel: 'ask',
      sessionLevel: 'bypass',
    })

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(setPermissionLevel).toHaveBeenCalledWith('ask')
    expect(state.sessionPermissionLevel.value).toBe('ask')
    expect(state.permissionLevelTouched.value).toBe(true)
  })

  it('writes this chat meta onto a new harness', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, setPermissionLevel } = harnessState({
      metaLevel: 'ask',
      sessionLevel: 'bypass',
    })

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(setPermissionLevel).toHaveBeenCalledWith('ask')
    expect(state.sessionPermissionLevel.value).toBe('ask')
    expect(state.permissionLevelTouched.value).toBe(true)
  })

  it('toasts when usage restore rejects without blocking initHarness', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    toastError.mockClear()

    const restoreUsageLedger = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('sqlite locked'))
    const restorePendingApprovals = vi.fn<() => void>()
    const setPermissionLevel = vi.fn<(level: string) => void>()
    vi.mocked(useAgentHarness).mockReturnValue({
      restoreUsageLedger,
      restorePendingApprovals,
      setPermissionLevel,
      sessionPermissionLevel: ref(null),
    } as unknown as ReturnType<typeof useAgentHarness>)

    const state = {
      chatId: computed(() => 'chat-1'),
      projectSlug: computed(() => 'proj'),
      isStandalone: computed(() => false),
      sessionPermissionLevel: ref('ask'),
      defaultPermissionLevel: computed(() => 'ask' as const),
      permissionLevelTouched: ref(false),
      paintedSession: shallowRef({ meta: computed(() => null) }),
      chatStore: { meta: computed(() => null) },
      harness: shallowRef(null),
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(restoreUsageLedger).toHaveBeenCalledTimes(1)
    await Promise.resolve()
    expect(toastError).toHaveBeenCalledWith('Failed to restore usage', {
      description: 'sqlite locked',
    })
  })
})

describe('createSessionOps loadThread reuse', () => {
  it('does not call initHarness when loadedThreadKey was pre-patched and harness exists', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    vi.mocked(useAgentHarness).mockClear()

    const restoreUsageLedger = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise(() => {}))
    const restorePendingApprovals = vi.fn<() => void>()

    const state = {
      chatId: computed(() => 'chat-1'),
      projectSlug: computed(() => 'dest'),
      threadKey: computed(() => 'dest:chat-1'),
      loadedThreadKey: ref('dest:chat-1'),
      harness: shallowRef({
        restoreUsageLedger,
        restorePendingApprovals,
        send: vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined),
      }),
      fleet: { loaded: ref(true) },
      isStandalone: computed(() => false),
      isSubagentView: computed(() => false),
      contextBudgetSync: {
        draftMentions: ref([]),
      },
      fleetSidebar: {
        refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
      },
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.loadThread()

    expect(useAgentHarness).not.toHaveBeenCalled()
    expect(restorePendingApprovals).toHaveBeenCalledTimes(1)
    expect(restoreUsageLedger).toHaveBeenCalledTimes(1)
  })
})

describe('createSessionOps loadThread permission restore', () => {
  const loadThreadState = (overrides?: {
    cachedLevel?: 'ask' | 'allowlist' | 'bypass' | null
    metaLevel?: 'ask' | 'allowlist' | 'bypass'
  }) => {
    const chatId = 'chat-b'
    const restoreUsageLedger = vi
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined)
    const restorePendingApprovals = vi.fn<() => void>()
    const setPermissionLevel = vi.fn<(level: string) => void>()
    vi.mocked(useAgentHarness).mockReturnValue({
      restoreUsageLedger,
      restorePendingApprovals,
      setPermissionLevel,
      sessionPermissionLevel: ref(overrides?.cachedLevel ?? null),
      send: vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useAgentHarness>)

    const nextMeta = computed(() =>
      overrides?.metaLevel
        ? {
            id: chatId,
            permissionLevel: overrides.metaLevel,
          }
        : { id: chatId },
    )

    const state = {
      chatId: computed(() => chatId),
      projectSlug: computed(() => 'proj'),
      threadKey: computed(() => `proj:${chatId}`),
      loadedThreadKey: ref('proj:chat-a'),
      loadGeneration: ref(0),
      threadReady: ref(true),
      homeRoot: ref('/tmp/home'),
      isStandalone: computed(() => false),
      isSubagentView: computed(() => false),
      sessionPermissionLevel: ref('allowlist' as const),
      defaultPermissionLevel: computed(() => 'bypass' as const),
      permissionLevelTouched: ref(true),
      paintedSession: shallowRef({
        meta: computed(() => ({
          id: 'chat-a',
          permissionLevel: 'allowlist' as const,
        })),
      }),
      harness: shallowRef({
        restoreUsageLedger: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        restorePendingApprovals: vi.fn<() => void>(),
        setPermissionLevel: vi.fn<(level: string) => void>(),
        send: vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined),
      }),
      project: computed(() => ({
        id: 'proj-id',
        rootPath: '/tmp/proj',
        name: 'Proj',
      })),
      fleet: {
        loaded: ref(true),
        activeProjectId: ref('proj-id'),
        setActiveProject: vi
          .fn<(id: string) => Promise<void>>()
          .mockResolvedValue(undefined),
      },
      chatStore: {
        meta: computed(() => null),
        selectChat: vi.fn<(slug: string, id: string) => unknown>().mockReturnValue({
          meta: nextMeta,
        }),
        isSessionWarm: vi
          .fn<(slug: string, id: string) => boolean>()
          .mockReturnValue(true),
        ensureChatHydrated: vi
          .fn<(slug: string, id: string) => Promise<string>>()
          .mockResolvedValue('cold'),
        refreshChatMeta: vi
          .fn<(slug: string, id: string) => Promise<void>>()
          .mockResolvedValue(undefined),
      },
      fleetSidebar: {
        refreshSlug: vi
          .fn<(slug: string) => Promise<void>>()
          .mockResolvedValue(undefined),
      },
      contextBudgetSync: {
        draftMentions: ref([]),
        refreshContextBudget: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      },
    } as unknown as AgentThreadViewState

    return { state, setPermissionLevel }
  }

  beforeEach(() => {
    sessionStorage.clear()
    vi.mocked(updateChatMeta).mockReset()
    vi.mocked(updateChatMeta).mockResolvedValue(savedChatMeta())
    toastError.mockClear()
  })

  it('adopts the next chat stored level instead of the previous chat dial', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, setPermissionLevel } = loadThreadState({
      metaLevel: 'ask',
    })

    const session = createSessionOps(state)
    await session.loadThread()

    expect(state.sessionPermissionLevel.value).toBe('ask')
    expect(state.permissionLevelTouched.value).toBe(true)
    expect(setPermissionLevel).toHaveBeenCalledWith('ask')
    expect(setPermissionLevel).not.toHaveBeenCalledWith('allowlist')
  })

  it('applies the settings default when the next chat has no stored level', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')
    const { state, setPermissionLevel } = loadThreadState()

    const session = createSessionOps(state)
    await session.loadThread()

    expect(state.sessionPermissionLevel.value).toBe('bypass')
    expect(state.permissionLevelTouched.value).toBe(false)
    expect(setPermissionLevel).toHaveBeenCalledWith('bypass')
    expect(setPermissionLevel).not.toHaveBeenCalledWith('allowlist')
  })
})
