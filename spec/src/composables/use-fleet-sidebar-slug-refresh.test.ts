import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMeta } from '@/types/chat/chat-meta'
import useFleetSidebarSlugRefresh from '@/composables/use-fleet-sidebar-slug-refresh'

const chats = (id: string): ChatMeta[] => [{ id } as ChatMeta]

describe('use-fleet-sidebar-slug-refresh', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fetches once after the coalescing window and applies the result', async () => {
    const fetchChats = vi.fn<(slug: string) => Promise<ChatMeta[]>>(async () => chats('a'))
    const applyChats = vi.fn<(slug: string, chats: ChatMeta[]) => void>()
    const refresh = useFleetSidebarSlugRefresh(fetchChats, applyChats)

    const pending = refresh('proj')
    expect(fetchChats).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(50)
    await pending

    expect(fetchChats).toHaveBeenCalledTimes(1)
    expect(applyChats).toHaveBeenCalledWith('proj', [{ id: 'a' }])
  })

  it('coalesces concurrent callers into one fetch plus one trailing re-read', async () => {
    const fetchChats = vi.fn<(slug: string) => Promise<ChatMeta[]>>(async () => chats('a'))
    const applyChats = vi.fn<(slug: string, chats: ChatMeta[]) => void>()
    const refresh = useFleetSidebarSlugRefresh(fetchChats, applyChats)

    const first = refresh('proj')
    await vi.advanceTimersByTimeAsync(50)
    // Second caller joins while the first fetch is still resolving.
    const second = refresh('proj')
    await vi.advanceTimersByTimeAsync(50)
    await Promise.all([first, second])

    expect(fetchChats).toHaveBeenCalledTimes(2)
    expect(applyChats).toHaveBeenCalledTimes(2)
  })

  it('cleans up after a failed fetch so later calls still run', async () => {
    const fetchChats = vi
      .fn<(slug: string) => Promise<ChatMeta[]>>()
      .mockRejectedValueOnce(new Error('db locked'))
      .mockResolvedValueOnce(chats('b'))
    const applyChats = vi.fn<(slug: string, chats: ChatMeta[]) => void>()
    const refresh = useFleetSidebarSlugRefresh(fetchChats, applyChats)

    let captured: unknown = null
    const failing = refresh('proj').catch((error: unknown) => {
      captured = error
    })
    await vi.advanceTimersByTimeAsync(50)
    await failing
    expect(captured).toMatchObject({ message: 'db locked' })

    const next = refresh('proj')
    await vi.advanceTimersByTimeAsync(50)
    await next

    expect(applyChats).toHaveBeenCalledWith('proj', [{ id: 'b' }])
  })
})