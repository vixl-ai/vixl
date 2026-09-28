import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import type { AgentThreadViewState } from '@/composables/agent-thread-view/types'
import { createSubmitHandlers } from '@/composables/agent-thread-view/handlers-submit'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const payload = {
  text: 'look at auth next',
  mode: 'agent' as const,
  model: 'openai/gpt-4o',
}

type FileMutationPreview = {
  path: string
  operation: 'update'
  additions: number
  deletions: number
}

const buildState = (overrides?: {
  isSubagentView?: boolean
  subagentId?: string
  lastRunConfig?: {
    mode: VixlChatMode
    model: string
    reasoning?: ReasoningLevel
  } | null
  sessionMeta?: { mode?: VixlChatMode; model?: string } | null
  fileMutations?: FileMutationPreview[]
  steerSubagent?: ReturnType<typeof vi.fn<(id: string, text: string) => Promise<void>>>
  stop?: ReturnType<typeof vi.fn<() => Promise<void>>>
  stopSubagent?: ReturnType<typeof vi.fn<(id: string) => void>>
  send?: ReturnType<typeof vi.fn<(args: unknown) => Promise<void>>>
  continueLastTurn?: ReturnType<typeof vi.fn<(args: unknown) => Promise<void>>>
}): {
  state: AgentThreadViewState
  steerSubagent: ReturnType<typeof vi.fn<(id: string, text: string) => Promise<void>>>
  stop: ReturnType<typeof vi.fn<() => Promise<void>>>
  stopSubagent: ReturnType<typeof vi.fn<(id: string) => void>>
  send: ReturnType<typeof vi.fn<(args: unknown) => Promise<void>>>
  continueLastTurn: ReturnType<typeof vi.fn<(args: unknown) => Promise<void>>>
} => {
  const steerSubagent =
    overrides?.steerSubagent ??
    vi.fn<(id: string, text: string) => Promise<void>>().mockResolvedValue(undefined)
  const stop =
    overrides?.stop ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const stopSubagent = overrides?.stopSubagent ?? vi.fn<(id: string) => void>()
  const send =
    overrides?.send ??
    vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined)
  const continueLastTurn =
    overrides?.continueLastTurn ??
    vi.fn<(args: unknown) => Promise<void>>().mockResolvedValue(undefined)
  const lastRunConfig =
    overrides?.lastRunConfig === undefined
      ? {
          mode: 'agent' as const,
          model: 'openai/gpt-4o',
          reasoning: 'medium' as const,
        }
      : overrides.lastRunConfig
  const filePolicyOpen = { value: false }
  const pendingFilePolicyAction = { value: null as unknown }
  const state = {
    isSubagentView: computed(() => overrides?.isSubagentView ?? false),
    subagentId: computed(() => overrides?.subagentId ?? ''),
    projectSlug: computed(() => 'proj'),
    harness: shallowRef({
      steerSubagent,
      stop,
      stopSubagent,
      send,
      continueLastTurn,
      lastRunConfig: { value: lastRunConfig },
      getLastTurnFileMutations: vi.fn<() => FileMutationPreview[]>(
        () => overrides?.fileMutations ?? [],
      ),
    }),
    paintedSession: shallowRef({
      meta: { value: overrides?.sessionMeta ?? null },
    }),
    filePolicyOpen,
    pendingFilePolicyAction,
    filePolicyTitle: { value: '' },
    filePolicyEmphasizeRevert: { value: false },
    filePolicyChanges: { value: [] },
    fleetSidebar: {
      refreshSlug: vi.fn<(slug: string) => Promise<void>>().mockResolvedValue(undefined),
    },
  } as unknown as AgentThreadViewState
  return { state, steerSubagent, stop, stopSubagent, send, continueLastTurn }
}

describe('createSubmitHandlers subagent view', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('routes submit to steerSubagent and does not send on the parent', async () => {
    const { state, steerSubagent, send } = buildState({
      isSubagentView: true,
      subagentId: 'sub-1',
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleSubmit(payload)
    expect(steerSubagent).toHaveBeenCalledWith('sub-1', 'look at auth next')
    expect(send).not.toHaveBeenCalled()
  })

  it('stops only the route subagent and does not stop the parent turn', async () => {
    const { state, stop, stopSubagent } = buildState({
      isSubagentView: true,
      subagentId: 'sub-1',
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleStop()
    expect(stopSubagent).toHaveBeenCalledWith('sub-1')
    expect(stop).not.toHaveBeenCalled()
  })

  it('stops the parent turn from the parent view', async () => {
    const { state, stop, stopSubagent } = buildState({
      isSubagentView: false,
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleStop()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(stopSubagent).not.toHaveBeenCalled()
  })
})

describe('createSubmitHandlers handleContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls continueLastTurn with resolved mode, model, and reasoning', async () => {
    const { state, continueLastTurn } = buildState({
      lastRunConfig: {
        mode: 'ask',
        model: 'anthropic/claude',
        reasoning: 'high',
      },
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleContinue()
    expect(continueLastTurn).toHaveBeenCalledWith({
      mode: 'ask',
      model: 'anthropic/claude',
      reasoning: 'high',
    })
  })

  it('never opens the file-policy dialog even when there are file mutations', async () => {
    const { state, continueLastTurn } = buildState({
      fileMutations: [
        { path: 'a.ts', operation: 'update', additions: 2, deletions: 1 },
      ],
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleContinue()
    expect(continueLastTurn).toHaveBeenCalledTimes(1)
    expect(state.filePolicyOpen.value).toBe(false)
    expect(state.pendingFilePolicyAction.value).toBeNull()
  })

  it('no-ops in a subagent view', async () => {
    const { state, continueLastTurn } = buildState({
      isSubagentView: true,
      subagentId: 'sub-1',
    })
    const handlers = createSubmitHandlers(state)
    await handlers.handleContinue()
    expect(continueLastTurn).not.toHaveBeenCalled()
  })
})
