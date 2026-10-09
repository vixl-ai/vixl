import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const hasPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => boolean>(() => false),
)
const hasRunningSubagentsForChat = vi.hoisted(() =>
  vi.fn<(chatId: string) => boolean>(() => false),
)
const shouldFlushBackgroundSubagentResume = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => 'resume' | 'clear' | 'noop'>(() => 'noop'),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
    listChats: async () => [],
  }),
)

vi.mock('@/services/harness/subagent/registry', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/services/harness/subagent/registry')
  >()
  return {
    ...actual,
    hasPendingBackgroundResume: (chatId: string) =>
      hasPendingBackgroundResume(chatId),
    hasRunningSubagentsForChat: (chatId: string) =>
      hasRunningSubagentsForChat(chatId),
  }
})

vi.mock('@/utils/should-flush-background-subagent-resume', () => ({
  default: (...args: unknown[]) => shouldFlushBackgroundSubagentResume(...args),
}))

vi.mock('@/services/harness/orchestrator', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  resumeOrchestrator: vi
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  continueOrchestrator: vi
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue(undefined),
  mapMetaStatusToChatStatus: (status: string) =>
    status === 'running' ? 'streaming' : 'ready',
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/router', () => ({
  default: {
    replace: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
  },
}))

import useAgentHarness, {
  dropAgentHarness,
  resetAgentHarnessCacheForTests,
} from '@/composables/use-agent-harness'
import { resetChatSessionsForTests } from '@/composables/use-chat-store'
import {
  resetSubagentRegistryForTests,
  subagentRegistryRevision,
} from '@/services/harness/subagent/registry'

const harnessOptions = {
  projectSlug: 'proj',
  projectRoot: '/tmp/proj',
  projectName: 'proj',
}

describe('agent harness effect scope', () => {
  beforeEach(() => {
    resetAgentHarnessCacheForTests()
    resetChatSessionsForTests()
    resetSubagentRegistryForTests()
    vi.clearAllMocks()
    hasPendingBackgroundResume.mockReturnValue(false)
    hasRunningSubagentsForChat.mockReturnValue(false)
    shouldFlushBackgroundSubagentResume.mockReturnValue('noop')
    updateChatMeta.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    dropAgentHarness('proj', 'chat-scope')
    dropAgentHarness('proj', 'chat-drop')
    await flushPromises()
    resetAgentHarnessCacheForTests()
    resetChatSessionsForTests()
  })

  it('runs the idle handler after the caller scope stops', async () => {
    const outer = effectScope()
    outer.run(() => {
      useAgentHarness({
        ...harnessOptions,
        chatId: 'chat-scope',
      })
    })
    outer.stop()

    const flushCalls = shouldFlushBackgroundSubagentResume.mock.calls.length
    subagentRegistryRevision.value += 1
    await nextTick()

    expect(shouldFlushBackgroundSubagentResume.mock.calls.length).toBe(flushCalls + 1)
  })

  it('stops reacting after dropAgentHarness', async () => {
    const outer = effectScope()
    outer.run(() => {
      useAgentHarness({
        ...harnessOptions,
        chatId: 'chat-drop',
      })
    })

    dropAgentHarness('proj', 'chat-drop')
    const pendingCalls = hasPendingBackgroundResume.mock.calls.length
    subagentRegistryRevision.value += 1
    await nextTick()

    expect(hasPendingBackgroundResume.mock.calls.length).toBe(pendingCalls)
    await flushPromises()
    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-drop', {
      status: 'idle',
    })
    expect(toastError).not.toHaveBeenCalled()
    outer.stop()
  })
})
