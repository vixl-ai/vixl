import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import syncContextActions from '@/composables/agent-thread-view/context-actions-sync'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

describe('syncContextActions', () => {
  it('keeps Compact clickable while a nested subagent is running', () => {
    const setDisabled = vi.fn<(next: {
      actionsDisabled?: boolean
      triggerDisabled?: boolean
    }) => void>()
    const register = vi.fn<(handlers: unknown) => void>()

    const state = {
      isSubagentView: computed(() => false),
      threadReady: ref(true),
      contextActions: {
        register,
        setDisabled,
        clear: vi.fn<() => void>(),
      },
    } as unknown as AgentThreadViewState

    syncContextActions(state, {
      handleCompact: vi.fn<() => Promise<void>>(),
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    expect(register).toHaveBeenCalled()
    expect(setDisabled).toHaveBeenCalledWith({
      triggerDisabled: false,
      actionsDisabled: false,
    })
  })

  it('disables Compact until the thread is ready', () => {
    const setDisabled = vi.fn<(next: {
      actionsDisabled?: boolean
      triggerDisabled?: boolean
    }) => void>()

    const state = {
      isSubagentView: computed(() => false),
      threadReady: ref(false),
      contextActions: {
        register: vi.fn<(handlers: unknown) => void>(),
        setDisabled,
        clear: vi.fn<() => void>(),
      },
    } as unknown as AgentThreadViewState

    syncContextActions(state, {
      handleCompact: vi.fn<() => Promise<void>>(),
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    expect(setDisabled).toHaveBeenCalledWith({
      triggerDisabled: true,
      actionsDisabled: true,
    })
  })
})
