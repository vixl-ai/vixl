import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { toast } from 'vue-sonner'
import useBrowserLockOverlay from '@/composables/use-browser-lock-overlay'
import useBrowserPassthroughSuspend from '@/composables/use-browser-passthrough-suspend'
import type { BrowserLock } from '@/types/browser/browser-lock'
import type { BrowserLockWaiter } from '@/types/browser/lock-waiter'

const takeControl = vi.hoisted(() => vi.fn<(sessionId: string) => void>())
const getSessionLock = vi.hoisted(
  () => vi.fn<(sessionId: string) => BrowserLock | null>(() => null),
)
const getSessionWaiters = vi.hoisted(
  () => vi.fn<(sessionId: string) => BrowserLockWaiter[]>(() => []),
)
const chatTitleForId = vi.hoisted(
  () => vi.fn<(chatId: string) => string | null>(() => null),
)
const routerPush = vi.hoisted(
  () => vi.fn<(to: string) => Promise<void>>(async () => undefined),
)
const listChats = vi.hoisted(
  () => vi.fn<(projectSlug: string) => Promise<{ id: string; title: string }[]>>(
    async () => [],
  ),
)
const revisionHolder = vi.hoisted(() => ({
  current: { value: 0 } as { value: number },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: (...args: [string]) => routerPush(...args),
  }),
}))

vi.mock('@/composables/use-fleet-sidebar', () => ({
  chatTitleForId: (chatId: string) => chatTitleForId(chatId),
}))

vi.mock('@/services/browser/registry', async () => {
  const vue = await vi.importActual<typeof import('vue')>('vue')
  const browserRegistryRevision = vue.ref(1)
  revisionHolder.current = browserRegistryRevision
  return {
    browserRegistryRevision,
    getSessionLock: (sessionId: string) => getSessionLock(sessionId),
    getSessionWaiters: (sessionId: string) => getSessionWaiters(sessionId),
    takeControl: (sessionId: string) => takeControl(sessionId),
  }
})

vi.mock('@/services/vixl/vixl-tauri', () => ({
  listChats: (projectSlug: string) => listChats(projectSlug),
}))

const sampleLock = (overrides: Partial<BrowserLock> = {}): BrowserLock => ({
  sessionId: 'cef-1',
  workspaceId: 'demo',
  ownerChatId: 'chat-owner-long-id',
  ownerSubagentId: null,
  viewId: 'cef-1',
  ...overrides,
})

describe('use-browser-lock-overlay', () => {
  let scope: ReturnType<typeof effectScope> | null = null

  beforeEach(() => {
    getSessionLock.mockReturnValue(null)
    getSessionWaiters.mockReturnValue([])
    chatTitleForId.mockReturnValue(null)
    listChats.mockResolvedValue([])
    takeControl.mockReset()
    routerPush.mockReset()
    vi.mocked(toast.success).mockReset()
    vi.mocked(toast.error).mockReset()
    revisionHolder.current.value = 1
  })

  afterEach(() => {
    scope?.stop()
    scope = null
  })

  const mountOverlay = (sessionId: string | null = 'cef-1') => {
    scope = effectScope()
    return scope.run(() => {
      const cefSessionId = ref(sessionId)
      return useBrowserLockOverlay({
        getCefSessionId: () => cefSessionId.value,
        cefSessionId,
      })
    })!
  }

  it('suspends CEF passthrough while locked and resumes when unlocked', async () => {
    const passthrough = useBrowserPassthroughSuspend()
    expect(passthrough.suspended.value).toBe(false)

    getSessionLock.mockReturnValue(sampleLock())
    const overlay = mountOverlay()
    expect(overlay.activeLock.value?.ownerChatId).toBe('chat-owner-long-id')
    expect(passthrough.suspended.value).toBe(true)

    getSessionLock.mockReturnValue(null)
    revisionHolder.current.value += 1
    await Promise.resolve()
    expect(overlay.activeLock.value).toBeNull()
    expect(passthrough.suspended.value).toBe(false)
  })

  it('falls back to a truncated chat id and shows subagent plus waiter count', () => {
    getSessionLock.mockReturnValue(
      sampleLock({ ownerSubagentId: 'subagent-abc' }),
    )
    getSessionWaiters.mockReturnValue([
      { chatId: 'chat-b', subagentId: null, enqueuedAt: 1 },
    ])
    const overlay = mountOverlay()
    expect(overlay.ownerTitle.value).toBe('chat-own')
    expect(overlay.ownerSubagentLabel.value).toBe('Subagent subagent')
    expect(overlay.waiterCount.value).toBe(1)
  })

  it('uses listChats title for the owner when fleet cache misses', async () => {
    getSessionLock.mockReturnValue(sampleLock())
    listChats.mockResolvedValue([
      { id: 'chat-owner-long-id', title: 'Research run' },
    ])
    const overlay = mountOverlay()
    await Promise.resolve()
    await Promise.resolve()
    expect(listChats).toHaveBeenCalledWith('demo')
    expect(overlay.ownerTitle.value).toBe('Research run')
  })

  it('opens the owner chat route and takeControl toasts success', async () => {
    getSessionLock.mockReturnValue(
      sampleLock({
        workspaceId: '_home_',
        ownerSubagentId: 'sub-1',
      }),
    )
    const overlay = mountOverlay()
    overlay.handleOpenOwnerChat()
    await Promise.resolve()
    expect(routerPush).toHaveBeenCalledWith(
      '/chat/chat-owner-long-id/subagent/sub-1',
    )

    overlay.handleTakeControl()
    expect(takeControl).toHaveBeenCalledWith('cef-1')
    expect(toast.success).toHaveBeenCalledWith('Took control of the browser')
  })
})
