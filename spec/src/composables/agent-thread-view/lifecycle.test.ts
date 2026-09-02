import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import type { ChatStatus } from 'ai'
import syncContextActions from '@/composables/agent-thread-view/context-actions-sync'

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

type RegisteredHandlers = {
  onCompact: () => void | Promise<void>
  onHandoff: () => void | Promise<void>
}

const buildState = (overrides?: {
  threadReady?: boolean
  compacting?: boolean
  parentStatus?: ChatStatus
  isSubagentView?: boolean
}): {
  state: AgentThreadViewState
  setDisabled: ReturnType<typeof vi.fn<(next: {
    actionsDisabled?: boolean
    triggerDisabled?: boolean
  }) => void>>
  register: ReturnType<typeof vi.fn<(handlers: RegisteredHandlers) => void>>
  compacting: ReturnType<typeof ref<boolean>>
} => {
  const setDisabled = vi.fn<(next: {
    actionsDisabled?: boolean
    triggerDisabled?: boolean
  }) => void>()
  const register = vi.fn<(handlers: RegisteredHandlers) => void>()
  const compacting = ref(overrides?.compacting ?? false)
  const harnessCompacting = ref(overrides?.compacting ?? false)
  const status = ref<ChatStatus>(overrides?.parentStatus ?? 'ready')
  const state = {
    isSubagentView: computed(() => overrides?.isSubagentView ?? false),
    threadReady: ref(overrides?.threadReady ?? true),
    harness: shallowRef({
      compacting: harnessCompacting,
      status,
    }),
    contextActions: {
      register,
      setDisabled,
      clear: vi.fn<() => void>(),
      compacting,
    },
  } as unknown as AgentThreadViewState

  return { state, setDisabled, register, compacting }
}

describe('syncContextActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps Compact clickable while a nested subagent is running', () => {
    const { state, setDisabled, register } = buildState()

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
    const { state, setDisabled } = buildState({ threadReady: false })

    syncContextActions(state, {
      handleCompact: vi.fn<() => Promise<void>>(),
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    expect(setDisabled).toHaveBeenCalledWith({
      triggerDisabled: true,
      actionsDisabled: true,
    })
  })

  it('mirrors harness compacting onto the singleton', () => {
    const { state, compacting, setDisabled } = buildState({ compacting: true })

    syncContextActions(state, {
      handleCompact: vi.fn<() => Promise<void>>(),
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    expect(compacting.value).toBe(true)
    expect(setDisabled).toHaveBeenCalledWith({
      triggerDisabled: false,
      actionsDisabled: true,
    })
  })

  it('disables actions while the parent is streaming', () => {
    const { state, setDisabled } = buildState({ parentStatus: 'streaming' })

    syncContextActions(state, {
      handleCompact: vi.fn<() => Promise<void>>(),
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    expect(setDisabled).toHaveBeenCalledWith({
      triggerDisabled: false,
      actionsDisabled: true,
    })
  })

  it('does not call handleCompact when already compacting', async () => {
    const { state, register } = buildState({ compacting: true })
    const handleCompact = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

    syncContextActions(state, {
      handleCompact,
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    await register.mock.calls[0]?.[0].onCompact()
    expect(handleCompact).not.toHaveBeenCalled()
  })

  it('awaits handleCompact and toasts on throw', async () => {
    const { state, register } = buildState()
    const handleCompact = vi
      .fn<() => Promise<void>>()
      .mockRejectedValue(new Error('compact exploded'))

    syncContextActions(state, {
      handleCompact,
      handleHandoff: vi.fn<() => Promise<void>>(),
    } as never)

    await register.mock.calls[0]?.[0].onCompact()
    expect(handleCompact).toHaveBeenCalledTimes(1)
    expect(toastError).toHaveBeenCalledWith(
      'Failed to compact chat',
      expect.objectContaining({ description: 'compact exploded' }),
    )
  })
})
