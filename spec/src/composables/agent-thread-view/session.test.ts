import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import { setPendingChatMessage } from '@/services/chat/pending-message'

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

describe('createSessionOps flushPendingChatMessage', () => {
  beforeEach(() => {
    sessionStorage.clear()
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
  })
})

describe('createSessionOps initHarness', () => {
  it('starts usage restore without awaiting it on the paint path', async () => {
    const { createSessionOps } = await import('@/composables/agent-thread-view/session')

    const restoreUsageLedger = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise(() => {}))
    const restorePendingApprovals = vi.fn<() => void>()
    const setPermissionLevel = vi.fn<(level: string) => void>()
    vi.mocked(useAgentHarness).mockReturnValue({
      restoreUsageLedger,
      restorePendingApprovals,
      setPermissionLevel,
    } as unknown as ReturnType<typeof useAgentHarness>)

    const state = {
      chatId: computed(() => 'chat-1'),
      projectSlug: computed(() => 'proj'),
      isStandalone: computed(() => false),
      sessionPermissionLevel: ref('ask'),
      harness: shallowRef(null),
    } as unknown as AgentThreadViewState

    const session = createSessionOps(state)
    await session.initHarness('/tmp/proj', 'Proj')

    expect(restorePendingApprovals).toHaveBeenCalledTimes(1)
    expect(restoreUsageLedger).toHaveBeenCalledTimes(1)
    expect(setPermissionLevel).toHaveBeenCalledWith('ask')
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
    } as unknown as ReturnType<typeof useAgentHarness>)

    const state = {
      chatId: computed(() => 'chat-1'),
      projectSlug: computed(() => 'proj'),
      isStandalone: computed(() => false),
      sessionPermissionLevel: ref('ask'),
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
