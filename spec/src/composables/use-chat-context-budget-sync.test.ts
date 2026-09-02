import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { UIMessage } from 'ai'
import { defaultVixlSettings } from '@/schemas/vixl-settings'

const refreshFns = vi.hoisted(() => ({
  current: [] as Array<ReturnType<typeof vi.fn>>,
}))

const loading = ref(false)
const timeline = ref<ChatTimelineItem[]>([])
const messages = ref<UIMessage[]>([])
const meta = ref<ChatMeta | null>(null)
const activeProject = ref<FleetProject | null>(null)
const serverStates = ref<Record<string, { status: string; tools: unknown[] }>>({})
const effectiveSettings = ref(defaultVixlSettings())

vi.mock('@/composables/use-chat-store', () => ({
  default: () => ({
    loading,
    timeline,
    messages,
    meta,
  }),
}))

vi.mock('@/composables/use-context-usage', () => ({
  default: () => {
    const refresh = vi.fn<() => Promise<void>>(async () => undefined)
    refreshFns.current.push(refresh)
    return { refresh }
  },
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    activeProject,
  }),
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    effectiveSettings,
  }),
}))

vi.mock('@/composables/use-mcp-servers', () => ({
  default: () => ({
    serverStates,
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const sampleMeta = (): ChatMeta => ({
  id: 'chat-1',
  title: 'Demo',
  projectSlug: 'demo',
  projectRoot: '/tmp/demo',
  mode: 'agent',
  model: 'openai::gpt-4.1',
  status: 'idle',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  forkedFrom: null,
  pinned: false,
  pinnedAt: null,
})

const sampleProject = (): FleetProject => ({
  id: 'proj-1',
  name: 'Demo',
  slug: 'demo',
  rootPath: '/tmp/demo',
  lastOpened: '2026-01-01T00:00:00.000Z',
})

const flushDeferredRefresh = async (): Promise<void> => {
  await nextTick()
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 0)
  })
}

describe('useChatContextBudgetSync', () => {
  beforeEach(() => {
    vi.resetModules()
    refreshFns.current = []
    loading.value = false
    timeline.value = []
    messages.value = []
    meta.value = sampleMeta()
    activeProject.value = sampleProject()
    serverStates.value = {}
    effectiveSettings.value = defaultVixlSettings()
  })

  it('skips refresh while chatStore.loading is true', async () => {
    loading.value = true
    const { default: useChatContextBudgetSync } = await import(
      '@/composables/use-chat-context-budget-sync'
    )
    const sync = useChatContextBudgetSync()
    const refresh = refreshFns.current.at(-1)
    expect(refresh).toBeDefined()

    await sync.refreshContextBudget()
    await flushDeferredRefresh()

    expect(refresh).not.toHaveBeenCalled()
  })

  it('applies refresh when loading is false and model and project root exist', async () => {
    const { default: useChatContextBudgetSync } = await import(
      '@/composables/use-chat-context-budget-sync'
    )
    const sync = useChatContextBudgetSync()
    await flushDeferredRefresh()
    const refresh = refreshFns.current.at(-1)
    expect(refresh).toBeDefined()
    refresh?.mockClear()

    await sync.refreshContextBudget()

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(refresh?.mock.calls[0]?.[0]).toMatchObject({
      modelId: 'openai::gpt-4.1',
      mode: 'agent',
      projectName: 'Demo',
      projectRoot: '/tmp/demo',
      chatId: 'chat-1',
    })
  })

  it('still recounts after a second setup when the first effectScope stops', async () => {
    const { default: useChatContextBudgetSync } = await import(
      '@/composables/use-chat-context-budget-sync'
    )

    const firstScope = effectScope()
    firstScope.run(() => {
      useChatContextBudgetSync()
    })
    await flushDeferredRefresh()
    const firstRefresh = refreshFns.current[0]
    expect(firstRefresh).toBeDefined()
    firstRefresh?.mockClear()

    firstScope.stop()

    const secondScope = effectScope()
    secondScope.run(() => {
      useChatContextBudgetSync()
    })
    const secondRefresh = refreshFns.current[1]
    expect(secondRefresh).toBeDefined()
    secondRefresh?.mockClear()
    firstRefresh?.mockClear()

    timeline.value = [{ type: 'compaction', summary: 'after unmount', focus: null }]
    await flushDeferredRefresh()

    expect(secondRefresh).toHaveBeenCalled()
    secondScope.stop()
  })
})
