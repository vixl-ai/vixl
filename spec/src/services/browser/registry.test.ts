import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserTab } from '@/types/browser/browser-tab'

const connectWsUrl = vi.hoisted(() =>
  vi.fn<(wsUrl: string) => Promise<{ send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }>>(),
)

const browserCefGetCdpWsUrl = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<string>>(),
)

vi.mock('@/services/browser/cdp-client', () => ({
  default: {
    connectWsUrl,
  },
}))

vi.mock('@/services/vixl/vixl-tauri/browser', () => ({
  browserCefGetCdpWsUrl,
}))

describe('browser-registry (N-session)', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    connectWsUrl.mockResolvedValue({
      send: vi.fn<() => Promise<unknown>>(),
      close: vi.fn<() => void>(),
    })
    browserCefGetCdpWsUrl.mockImplementation(async (sessionId: string) => {
      return `ws://127.0.0.1:9333/devtools/page/${sessionId}`
    })
    const { resetBrowserRegistryForTests } = await import('@/services/browser/registry')
    resetBrowserRegistryForTests()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('acquires and releases a lock per CEF session', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLock,
      assertLockedBy,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })

    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(assertLockedBy({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    releaseLock({ sessionId: 'cef-1', chatId: 'chat-a' })

    expect(assertLockedBy({ sessionId: 'cef-1', chatId: 'chat-a' }).ok).toBe(false)
  })

  it('allows concurrent locks on different sessions', async () => {
    const { registerCefSession, acquireLock, assertLockedBy } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })

    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(await acquireLock({ sessionId: 'cef-2', chatId: 'chat-b' })).toEqual({ ok: true })
    expect(assertLockedBy({ sessionId: 'cef-1', chatId: 'chat-a' }).ok).toBe(true)
    expect(assertLockedBy({ sessionId: 'cef-2', chatId: 'chat-b' }).ok).toBe(true)
  })

  it('refuses acquire when another chat holds the lock and wait is false', async () => {
    const { registerCefSession, acquireLock } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const denied = await acquireLock({ sessionId: 'cef-1', chatId: 'chat-b' })
    expect(denied).toEqual({
      ok: false,
      error: 'browser_locked',
      ownerChatId: 'chat-a',
      ownerTitle: null,
      queueLength: 0,
    })
  })

  it('allows the same chat to re-acquire including a subagent', async () => {
    const { registerCefSession, acquireLock, getSessionLock } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    expect(
      await acquireLock({
        sessionId: 'cef-1',
        chatId: 'chat-a',
        subagentId: 'sub-1',
      }),
    ).toEqual({ ok: true })

    const lock = getSessionLock('cef-1')
    expect(lock?.ownerChatId).toBe('chat-a')
    expect(lock?.ownerSubagentId).toBe('sub-1')
    expect(lock).not.toHaveProperty('leaseExpiresAt')
  })

  it('takeControl preempts any owner on that session only', async () => {
    const { registerCefSession, acquireLock, takeControl, assertLockedBy } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })

    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(await acquireLock({ sessionId: 'cef-2', chatId: 'chat-b' })).toEqual({ ok: true })

    takeControl('cef-1')

    expect(assertLockedBy({ sessionId: 'cef-1', chatId: 'chat-a' }).ok).toBe(false)
    expect(assertLockedBy({ sessionId: 'cef-2', chatId: 'chat-b' }).ok).toBe(true)
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-c' })).toEqual({ ok: true })
  })

  it('does not expire a held lock over time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))

    const { registerCefSession, acquireLock } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    vi.setSystemTime(new Date('2026-01-01T01:00:00.000Z'))

    const denied = await acquireLock({ sessionId: 'cef-1', chatId: 'chat-b', wait: false })
    expect(denied).toMatchObject({ ok: false, error: 'browser_locked', ownerChatId: 'chat-a' })
  })

  it('queues wait:true FIFO and grants the next waiter on unlock', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLock,
      getSessionLock,
      getSessionWaiters,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const first = acquireLock({ sessionId: 'cef-1', chatId: 'chat-b', wait: true })
    const second = acquireLock({ sessionId: 'cef-1', chatId: 'chat-c', wait: true })
    await Promise.resolve()

    expect(getSessionWaiters('cef-1').map((waiter) => waiter.chatId)).toEqual([
      'chat-b',
      'chat-c',
    ])

    const bailed = await acquireLock({ sessionId: 'cef-1', chatId: 'chat-d', wait: false })
    expect(bailed).toMatchObject({
      ok: false,
      error: 'browser_locked',
      queueLength: 2,
    })

    releaseLock({ sessionId: 'cef-1', chatId: 'chat-a' })
    await expect(first).resolves.toEqual({ ok: true })
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-b')
    expect(getSessionWaiters('cef-1').map((waiter) => waiter.chatId)).toEqual(['chat-c'])

    releaseLock({ sessionId: 'cef-1', chatId: 'chat-b' })
    await expect(second).resolves.toEqual({ ok: true })
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-c')
  })

  it('takeControl cancels waiters and does not auto-grant the next agent', async () => {
    const {
      registerCefSession,
      acquireLock,
      takeControl,
      getSessionLock,
      getSessionWaiters,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const waiting = acquireLock({ sessionId: 'cef-1', chatId: 'chat-b', wait: true })
    await Promise.resolve()
    expect(getSessionWaiters('cef-1')).toHaveLength(1)

    takeControl('cef-1')

    await expect(waiting).resolves.toEqual({
      ok: false,
      error: 'browser_lock_cancelled',
      cancelled: 'user_took_control',
    })
    expect(getSessionLock('cef-1')).toBeNull()
    expect(getSessionWaiters('cef-1')).toEqual([])
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-c' })).toEqual({ ok: true })
  })

  it('AbortSignal unblocks a parked waiter', async () => {
    const { registerCefSession, acquireLock, getSessionWaiters, getSessionLock } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const controller = new AbortController()
    const waiting = acquireLock({
      sessionId: 'cef-1',
      chatId: 'chat-b',
      wait: true,
      signal: controller.signal,
    })
    await Promise.resolve()
    expect(getSessionWaiters('cef-1')).toHaveLength(1)

    controller.abort()

    await expect(waiting).resolves.toEqual({
      ok: false,
      error: 'browser_lock_cancelled',
      cancelled: 'aborted',
    })
    expect(getSessionWaiters('cef-1')).toEqual([])
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-a')
  })

  it('releaseLocksForChat unlocks the owner and grants the next waiter', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLocksForChat,
      getSessionLock,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const waiting = acquireLock({ sessionId: 'cef-1', chatId: 'chat-b', wait: true })
    await Promise.resolve()

    releaseLocksForChat('chat-a', 'aborted')
    await expect(waiting).resolves.toEqual({ ok: true })
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-b')
  })

  it('releaseLocksForChat run_complete grants the next waiter', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLocksForChat,
      getSessionLock,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const waiting = acquireLock({ sessionId: 'cef-1', chatId: 'chat-b', wait: true })
    await Promise.resolve()

    releaseLocksForChat('chat-a', 'run_complete')
    await expect(waiting).resolves.toEqual({ ok: true })
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-b')
  })

  it('grants every waiter from the same chat together', async () => {
    const { registerCefSession, acquireLock, releaseLock, getSessionLock } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })

    const parentWait = acquireLock({
      sessionId: 'cef-1',
      chatId: 'chat-b',
      wait: true,
    })
    const subWait = acquireLock({
      sessionId: 'cef-1',
      chatId: 'chat-b',
      subagentId: 'sub-1',
      wait: true,
    })
    await Promise.resolve()

    releaseLock({ sessionId: 'cef-1', chatId: 'chat-a' })
    await expect(parentWait).resolves.toEqual({ ok: true })
    await expect(subWait).resolves.toEqual({ ok: true })
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-b')
  })

  it('upserts, lists, removes tabs and tracks lastInteractedViewId', async () => {
    const {
      upsertTab,
      listTabs,
      removeTab,
      setLastInteractedViewId,
      getLastInteractedViewId,
    } = await import('@/services/browser/registry')

    const tabA: BrowserTab = {
      viewId: 'cef-a',
      workspaceId: 'ws-1',
      url: 'https://example.com/a',
      title: 'A',
      createdAt: '2026-01-01T00:00:00.000Z',
    }
    const tabB: BrowserTab = {
      viewId: 'cef-b',
      workspaceId: 'ws-1',
      url: 'https://example.com/b',
      title: null,
      createdAt: '2026-01-01T00:00:01.000Z',
    }

    upsertTab('ws-1', tabA)
    upsertTab('ws-1', tabB)
    setLastInteractedViewId('ws-1', 'cef-a')

    expect(listTabs('ws-1')).toEqual([tabA, tabB])
    expect(getLastInteractedViewId('ws-1')).toBe('cef-a')

    upsertTab('ws-1', { ...tabA, title: 'A updated', url: 'https://example.com/a2' })
    expect(listTabs('ws-1')).toEqual([
      { ...tabA, title: 'A updated', url: 'https://example.com/a2' },
      tabB,
    ])

    removeTab('ws-1', 'cef-a')
    expect(listTabs('ws-1')).toEqual([tabB])
    expect(getLastInteractedViewId('ws-1')).toBe('cef-b')
  })

  it('acquireSession returns a CDP client for the session', async () => {
    const { registerCefSession, acquireSession } = await import(
      '@/services/browser/registry'
    )

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    const result = await acquireSession({ sessionId: 'cef-1', chatId: 'chat-a' })
    expect(result).toMatchObject({ ok: true })
    expect(result.ok && result.client).toBeTruthy()
    expect(browserCefGetCdpWsUrl).toHaveBeenCalledWith('cef-1')
    expect(connectWsUrl).toHaveBeenCalled()
  })

  it('reset clears all registry state', async () => {
    const {
      registerCefSession,
      acquireLock,
      upsertTab,
      setLastInteractedViewId,
      resetBrowserRegistryForTests,
      listTabs,
      getLastInteractedViewId,
      browserRegistryRevision,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    upsertTab('ws-1', {
      viewId: 'cef-1',
      workspaceId: 'ws-1',
      url: 'https://example.com',
      title: 'Example',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    setLastInteractedViewId('ws-1', 'cef-1')
    expect(browserRegistryRevision.value).toBeGreaterThan(0)

    resetBrowserRegistryForTests()

    expect(listTabs('ws-1')).toEqual([])
    expect(getLastInteractedViewId('ws-1')).toBeNull()
    expect(browserRegistryRevision.value).toBe(0)
  })

  it('resolves explicit session, then chat preferred, then last interacted', async () => {
    const {
      registerCefSession,
      setLastInteractedViewId,
      setChatPreferredSession,
      resolveSessionIdForWorkspace,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-3', workspaceId: 'ws-1' })
    setLastInteractedViewId('ws-1', 'cef-1')
    setChatPreferredSession('chat-a', 'cef-2')

    expect(resolveSessionIdForWorkspace('ws-1', 'cef-3', 'chat-a')).toBe('cef-3')
    expect(resolveSessionIdForWorkspace('ws-1', undefined, 'chat-a')).toBe('cef-2')
    expect(resolveSessionIdForWorkspace('ws-1', undefined, 'chat-b')).toBe('cef-1')
    expect(resolveSessionIdForWorkspace('ws-1', 'missing', 'chat-a')).toBeNull()
  })

  it('keeps chat preferred after unlock', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLock,
      getChatPreferredSession,
      resolveSessionIdForWorkspace,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBe('cef-1')

    releaseLock({ sessionId: 'cef-1', chatId: 'chat-a' })

    expect(getChatPreferredSession('ws-1', 'chat-a')).toBe('cef-1')
    expect(resolveSessionIdForWorkspace('ws-1', undefined, 'chat-a')).toBe('cef-1')
  })

  it('does not overwrite preferred on a later acquire of another session', async () => {
    const {
      registerCefSession,
      acquireLock,
      getChatPreferredSession,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(await acquireLock({ sessionId: 'cef-2', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBe('cef-1')
  })

  it('does not steal another page lock when assigning preferred', async () => {
    const {
      registerCefSession,
      acquireLock,
      setChatPreferredSession,
      getSessionLock,
      getChatPreferredSession,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    registerCefSession({ sessionId: 'cef-2', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    expect(await acquireLock({ sessionId: 'cef-2', chatId: 'chat-b' })).toEqual({ ok: true })

    setChatPreferredSession('chat-a', 'cef-2')

    expect(getChatPreferredSession('ws-1', 'chat-a')).toBe('cef-2')
    expect(getSessionLock('cef-1')?.ownerChatId).toBe('chat-a')
    expect(getSessionLock('cef-2')?.ownerChatId).toBe('chat-b')
  })

  it('exclusive assign keeps one preferred chat per session', async () => {
    const {
      registerCefSession,
      setChatPreferredSession,
      assignExclusivePreferredSession,
      getChatPreferredSession,
      getPreferredChatIdForSession,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    setChatPreferredSession('chat-a', 'cef-1')
    assignExclusivePreferredSession('chat-b', 'cef-1')

    expect(getPreferredChatIdForSession('ws-1', 'cef-1')).toBe('chat-b')
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBeNull()
    expect(getChatPreferredSession('ws-1', 'chat-b')).toBe('cef-1')
  })

  it('drops preferred when the CEF session is unregistered', async () => {
    const {
      registerCefSession,
      unregisterCefSession,
      setChatPreferredSession,
      getChatPreferredSession,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    setChatPreferredSession('chat-a', 'cef-1')
    unregisterCefSession('cef-1')
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBeNull()
  })

  it('drops preferred on chat_deleted but not on run_complete', async () => {
    const {
      registerCefSession,
      acquireLock,
      releaseLocksForChat,
      getChatPreferredSession,
    } = await import('@/services/browser/registry')

    registerCefSession({ sessionId: 'cef-1', workspaceId: 'ws-1' })
    expect(await acquireLock({ sessionId: 'cef-1', chatId: 'chat-a' })).toEqual({ ok: true })
    releaseLocksForChat('chat-a', 'run_complete')
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBe('cef-1')

    releaseLocksForChat('chat-a', 'chat_deleted')
    expect(getChatPreferredSession('ws-1', 'chat-a')).toBeNull()
  })
})
