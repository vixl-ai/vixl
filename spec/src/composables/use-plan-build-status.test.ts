import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, type ComputedRef } from 'vue'
import type { ChatMeta, ChatStatus } from '@/types/chat/chat-meta'

const forChat = vi.hoisted(
  () =>
    vi.fn<
      (projectSlug: string, chatId: string) => { meta: ComputedRef<ChatMeta | null> }
    >(),
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
  }),
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    getProject: (projectId: string) => getProject(projectId),
  }),
}))

describe('use-plan-build-status', () => {
  beforeEach(() => {
    sessionStatus.value = 'idle'
    project.value = { slug: 'proj' }
    forChat.mockReset()
    getProject.mockReset()
    getProject.mockImplementation(() => project.value)
    forChat.mockImplementation((_slug, _chatId) => ({
      meta: computed((): ChatMeta | null =>
        sessionStatus.value === null
          ? null
          : ({ status: sessionStatus.value } as ChatMeta),
      ),
    }))
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
})
