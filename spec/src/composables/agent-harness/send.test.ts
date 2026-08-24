import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const runOrchestrator = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const listConfiguredProviders = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => string[]>(() => ['openai']),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/harness/orchestrator', () => ({
  default: (...args: unknown[]) => runOrchestrator(...args),
}))

vi.mock('@/services/providers/list-configured-providers', () => ({
  default: (...args: unknown[]) => listConfiguredProviders(...args),
}))

vi.mock('@/services/skills/skill-registry', () => ({
  listSlashSkillIndex: vi.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

import createSend from '@/composables/agent-harness/send'

const settings = (): VixlSettings => ({ version: 1 })

const buildState = (): AgentHarnessState => {
  const patchMeta = vi.fn<(patch: unknown) => void>()
  const startAgentTurn = vi.fn<(turnId: string) => void>()
  const finishAgentTurn = vi.fn<() => void>()
  const setAgentTurnError = vi.fn<(error: unknown) => void>()
  const refreshSlug = vi
    .fn<(slug: string) => Promise<void>>()
    .mockResolvedValue(undefined)
  const setDraftMentions = vi.fn<(mentions: unknown[]) => void>()

  return {
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      projectName: 'proj',
      standalone: false,
    },
    session: {
      patchMeta,
      appendLocalMessage: vi.fn<(...args: unknown[]) => void>(),
      startAgentTurn,
      finishAgentTurn,
      setAgentTurnError,
      messages: ref([]),
      timeline: ref([]),
    },
    config: {
      hydrated: computed(() => true),
      effectiveSettings: computed(() => settings()),
    },
    status: ref('ready'),
    error: ref(null),
    toolRuns: shallowRef([]),
    subagents: shallowRef([]),
    abortController: ref(null),
    lastRunConfig: ref(null),
    sessionPermissionLevel: ref(null),
    contextBudgetSync: {
      setDraftMentions,
    },
    fleetSidebar: {
      refreshSlug,
    },
    messageQueue: {
      enqueue: vi.fn<(...args: unknown[]) => void>(),
    },
  } as unknown as AgentHarnessState
}

const buildAttention = (): AttentionHelpers =>
  ({
    isParentBusy: () => false,
    isWaitingOnBackground: () => false,
    applyTurnEndAttention: vi.fn<(...args: unknown[]) => void>(),
    refreshSidebar: vi.fn<(...args: unknown[]) => void>(),
    setChatAttention: vi.fn<(...args: unknown[]) => void>(),
    maybeClearAttentionWhenGatesEmpty: vi.fn<(...args: unknown[]) => void>(),
    isFullyIdle: () => true,
  }) as unknown as AttentionHelpers

describe('agent-harness send persist model/mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    runOrchestrator.mockResolvedValue(undefined)
    listConfiguredProviders.mockReturnValue(['openai'])
  })

  it('persists model and mode via updateChatMeta before the turn', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(updateChatMeta).toHaveBeenCalledWith('proj', 'chat-1', {
      model: 'openai::gpt-4o',
      mode: 'agent',
    })
    expect(state.session.patchMeta).toHaveBeenCalledWith({
      model: 'openai::gpt-4o',
      mode: 'agent',
    })
    expect(state.lastRunConfig.value).toEqual(
      expect.objectContaining({
        model: 'openai::gpt-4o',
        mode: 'agent',
      }),
    )
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts on meta failure then continues the turn', async () => {
    updateChatMeta.mockRejectedValueOnce(new Error('disk full'))
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'plan',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(toastError).toHaveBeenCalledWith(
      'Failed to save chat model',
      expect.objectContaining({
        description: 'disk full',
      }),
    )
    expect(state.session.patchMeta).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
  })
})
