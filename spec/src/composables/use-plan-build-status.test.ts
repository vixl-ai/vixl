import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, type ComputedRef } from 'vue'
import type { ChatMeta, ChatStatus } from '@/types/chat/chat-meta'

const forChat = vi.hoisted(
  () =>
    vi.fn<
      (projectSlug: string, chatId: string) => { meta: ComputedRef<ChatMeta | null> }
    >(),
)
const refreshChatMeta = vi.hoisted(
  () =>
    vi.fn<(projectSlug: string, chatId: string) => Promise<void>>(
      async () => undefined,
    ),
)
const getProject = vi.hoisted(
  () =>
    vi.fn<(projectId: string) => { slug: string } | null>(),
)

const sessionStatus = ref<ChatStatus | null>('idle')
const project = ref<{ slug: string } | null>({ slug: 'proj' })

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    forChat: (projectSlug: string, chatId: string) => forChat(projectSlug, chatId),
    refreshChatMeta: (projectSlug: string, chatId: string) =>
      refreshChatMeta(projectSlug, chatId),
  }),
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    getProject: (projectId: string) => getProject(projectId),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

import { toast } from 'vue-sonner'

describe('use-plan-build-status', () => {
  beforeEach(() => {
    sessionStatus.value = 'idle'
    project.value = { slug: 'proj' }
    forChat.mockReset()
    refreshChatMeta.mockReset()
    refreshChatMeta.mockResolvedValue(undefined)
    getProject.mockReset()
    getProject.mockImplementation(() => project.value)
    forChat.mockImplementation((_slug, _chatId) => ({
      meta: computed((): ChatMeta | null =>
        sessionStatus.value === null
          ? null
          : ({ status: sessionStatus.value } as ChatMeta),
      ),
    }))
    vi.mocked(toast.error).mockClear()
  })

  it('prefers lastBuildChatId over sourceChatId and tracks running status', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const sourceChatId = ref<string | null>('source-chat')
    const { buildChatId, buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    expect(buildChatId.value).toBe('build-chat')
    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).toHaveBeenCalledWith('proj', 'build-chat')

    sessionStatus.value = 'running'
    expect(buildChatStatus.value).toBe('running')
  })

  it('resolves lastBuildChatId under lastBuildChatSlug instead of the tab slug', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const lastBuildChatSlug = ref<string | null>('stack')
    const sourceChatId = ref<string | null>('source-chat')
    const { buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      lastBuildChatSlug,
      sourceChatId,
    })

    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).toHaveBeenCalledWith('stack', 'build-chat')
    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('stack', 'build-chat')
    })
  })

  it('falls back to the tab slug when lastBuildChatSlug is missing', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const lastBuildChatSlug = ref<string | null>(null)
    const sourceChatId = ref<string | null>(null)
    const { buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      lastBuildChatSlug,
      sourceChatId,
    })

    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).toHaveBeenCalledWith('proj', 'build-chat')
    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('proj', 'build-chat')
    })
  })

  it('resolves sourceChatId under sourceChatSlug when lastBuildChatId is missing', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>(null)
    const lastBuildChatSlug = ref<string | null>(null)
    const sourceChatId = ref<string | null>('source-chat')
    const sourceChatSlug = ref<string | null>('stack')
    const { buildChatId, buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      lastBuildChatSlug,
      sourceChatId,
      sourceChatSlug,
    })

    expect(buildChatId.value).toBe('source-chat')
    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).toHaveBeenCalledWith('stack', 'source-chat')
    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('stack', 'source-chat')
    })
  })

  it('falls back to sourceChatId and idle when slug or chat id is missing', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>(null)
    const sourceChatId = ref<string | null>('source-chat')
    const { buildChatId, buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    expect(buildChatId.value).toBe('source-chat')
    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).toHaveBeenCalledWith('proj', 'source-chat')

    forChat.mockClear()
    project.value = null
    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).not.toHaveBeenCalled()

    project.value = { slug: 'proj' }
    sourceChatId.value = null
    expect(buildChatStatus.value).toBe('idle')
    expect(forChat).not.toHaveBeenCalled()
  })

  it('hydrates chat meta for lastBuildChatId and again when the id changes', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const sourceChatId = ref<string | null>('source-chat')
    usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('proj', 'build-chat')
    })
    expect(refreshChatMeta).toHaveBeenCalledTimes(1)

    lastBuildChatId.value = 'other-build'
    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('proj', 'other-build')
    })
    expect(refreshChatMeta).toHaveBeenCalledTimes(2)
  })

  it('hydrates sourceChatId when lastBuildChatId is missing', async () => {
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>(null)
    const sourceChatId = ref<string | null>('source-chat')
    usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    await vi.waitFor(() => {
      expect(refreshChatMeta).toHaveBeenCalledWith('proj', 'source-chat')
    })
  })

  it('flags missing chats without toasting when Chat not found', async () => {
    refreshChatMeta.mockRejectedValue(new Error('Chat not found'))
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const sourceChatId = ref<string | null>('source-chat')
    const { buildChatMissing, missingChatIds, buildChatStatus } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    await vi.waitFor(() => {
      expect(missingChatIds.value).toContain('build-chat')
    })
    expect(buildChatMissing.value).toBe(true)
    expect(buildChatStatus.value).toBe('idle')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts other hydration errors and does not flag the chat missing', async () => {
    refreshChatMeta.mockRejectedValue(new Error('disk full'))
    const { default: usePlanBuildStatus } = await import(
      '@/composables/use-plan-build-status'
    )
    const lastBuildChatId = ref<string | null>('build-chat')
    const sourceChatId = ref<string | null>(null)
    const { buildChatMissing, missingChatIds } = usePlanBuildStatus({
      projectId: 'proj-1',
      lastBuildChatId,
      sourceChatId,
    })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to load plan build status', {
        description: 'disk full',
      })
    })
    expect(missingChatIds.value).toEqual([])
    expect(buildChatMissing.value).toBe(false)
  })
})
