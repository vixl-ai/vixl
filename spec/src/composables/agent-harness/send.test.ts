import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref, shallowRef, type Ref } from 'vue'
import type { AgentHarnessState, AttentionHelpers } from '@/composables/agent-harness/types'
import type { PendingQuestionState } from '@/types/chat/pending-question'
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
const normalizeImageDataUrl = vi.hoisted(() =>
  vi.fn<(args: { dataUrl: string; mediaType: string }) => Promise<{
    dataUrl: string
    mediaType: string
  }>>(async (args) => args),
)

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

const listAgentIndex = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]),
)
const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
)

vi.mock('@/services/agents/registry', () => ({
  listAgentIndex: (...args: unknown[]) => listAgentIndex(...args),
  resolveAgentDefinition: (...args: unknown[]) => resolveAgentDefinition(...args),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  hasPendingBackgroundResume: () => false,
  hasRunningSubagentsForChat: () => false,
}))

const loadEffectiveSettings = vi.hoisted(() =>
  vi.fn<(rootPath: string | null) => Promise<VixlSettings>>(),
)

vi.mock('@/services/config/vixl-config', () => ({
  loadEffectiveSettings,
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
  },
}))

vi.mock('@/utils/normalize-image-data-url', () => ({
  default: (
    args: { dataUrl: string; mediaType: string },
  ) => normalizeImageDataUrl(args),
}))

import createSend from '@/composables/agent-harness/send'
import createHelpers from '@/composables/agent-harness/helpers'

const settings = (): VixlSettings => ({ version: 1 })

type SendTestState = AgentHarnessState & {
  session: AgentHarnessState['session'] & {
    pendingQuestion: Ref<PendingQuestionState | null>
  }
}

const buildState = (): SendTestState => {
  const patchMeta = vi.fn<(patch: unknown) => void>()
  const startAgentTurn = vi.fn<(turnId: string) => void>()
  const finishAgentTurn = vi.fn<() => void>()
  const setAgentTurnError = vi.fn<(error: unknown) => void>()
  const refreshSlug = vi
    .fn<(slug: string) => Promise<void>>()
    .mockResolvedValue(undefined)
  const setDraftMentions = vi.fn<(mentions: unknown[]) => void>()
  const pendingQuestion = ref<PendingQuestionState | null>(null)

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
      pendingQuestion,
      submitAnswer: vi.fn<(toolCallId: string, answer: string) => void>(),
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
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    compacting: ref(false),
    resumingBackgroundBatch: ref(false),
    contextBudgetSync: {
      setDraftMentions,
    },
    fleetSidebar: {
      refreshSlug,
    },
    messageQueue: {
      enqueue: vi.fn<(...args: unknown[]) => void>(),
    },
  } as unknown as SendTestState
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
    listAgentIndex.mockResolvedValue([])
    resolveAgentDefinition.mockResolvedValue(null)
    loadEffectiveSettings.mockResolvedValue({ version: 1 })
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

  it('enqueues a user send while compacting', async () => {
    const state = buildState()
    state.compacting.value = true
    const attention = createHelpers(state)
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.messageQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello' }),
    )
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('reuses the same session allow and deny sets on a second send', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const payload = {
      text: 'hello',
      mode: 'agent' as const,
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    }

    await send(payload)
    state.sessionAllows.add('fs.write')
    await send(payload)

    expect(runOrchestrator).toHaveBeenCalledTimes(2)
    const first = runOrchestrator.mock.calls[0]?.[0] as {
      sessionAllows: Set<string>
      sessionDenies: Set<string>
    }
    const second = runOrchestrator.mock.calls[1]?.[0] as {
      sessionAllows: Set<string>
      sessionDenies: Set<string>
    }
    expect(first.sessionAllows).toBe(state.sessionAllows)
    expect(first.sessionDenies).toBe(state.sessionDenies)
    expect(second.sessionAllows).toBe(state.sessionAllows)
    expect(second.sessionDenies).toBe(state.sessionDenies)
    expect(second.sessionAllows.has('fs.write')).toBe(true)
  })

  it('loads effective settings for the chat project root', async () => {
    const chatSettings: VixlSettings = {
      version: 1,
      'agent.permissionLevel': 'allowlist',
    }
    loadEffectiveSettings.mockResolvedValue(chatSettings)
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

    expect(loadEffectiveSettings).toHaveBeenCalledWith('/tmp/proj')
    expect(state.lastRunConfig.value?.effectiveSettings).toEqual(chatSettings)
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ settings: chatSettings }),
    )
  })

  it('loads personal settings when the chat is standalone', async () => {
    const personalSettings: VixlSettings = { version: 1 }
    loadEffectiveSettings.mockResolvedValue(personalSettings)
    const state = buildState()
    state.options.standalone = true
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

    expect(loadEffectiveSettings).toHaveBeenCalledWith(null)
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ settings: personalSettings }),
    )
  })

  it('turns raw /reviewer text into an agent mention on send', async () => {
    listAgentIndex.mockResolvedValue([
      {
        id: 'reviewer',
        name: 'reviewer',
        description: 'Review helper',
        scope: 'project',
        path: '/tmp/proj/.vixl/agents/reviewer.md',
      },
    ])
    resolveAgentDefinition.mockResolvedValue({
      id: 'reviewer',
      name: 'reviewer',
      description: 'Review helper',
      body: 'Review the change.',
      path: '/tmp/proj/.vixl/agents/reviewer.md',
      scope: 'project',
    })
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '/reviewer rest',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: [{ type: 'agent', name: 'reviewer' }],
      }),
    )
  })

  it('leaves /unknown-agent as plain text', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '/unknown-agent rest',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: [],
      }),
    )
    expect(toastError).not.toHaveBeenCalled()
  })

  it('toasts and drops an agent mention when the catalog file is gone', async () => {
    resolveAgentDefinition.mockResolvedValue(null)
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'check auth',
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [{ type: 'agent', name: 'reviewer' }],
      skipUserMessage: true,
      internal: true,
    })

    expect(toastError).toHaveBeenCalledWith(
      'Agent not found',
      expect.objectContaining({
        description: expect.stringContaining('reviewer'),
      }),
    )
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: [],
      }),
    )
  })

  it('keeps reserved /agent as a skill even when the catalog has that name', async () => {
    listAgentIndex.mockResolvedValue([
      {
        id: 'agent',
        name: 'agent',
        description: 'Custom agent named agent',
        scope: 'user',
        path: '/tmp/personal/.vixl/agents/agent.md',
      },
    ])
    resolveAgentDefinition.mockResolvedValue({
      id: 'agent',
      name: 'agent',
      description: 'Custom agent named agent',
      body: 'Do custom agent work.',
      path: '/tmp/personal/.vixl/agents/agent.md',
      scope: 'user',
    })
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '/agent rest',
      mode: 'agent',
      model: 'openai::gpt-4o',
      mentions: [{ type: 'agent', name: 'agent' }],
      skipUserMessage: true,
      internal: true,
    })

    expect(toastError).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        mentions: [{ type: 'skill', name: 'agent' }],
      }),
    )
  })

  it('treats a composer send as the answer to a pending question', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    state.session.pendingQuestion.value = {
      toolCallId: 'q-1',
      question: 'Which approach?',
    }
    vi.mocked(state.session.submitAnswer).mockImplementation(
      (toolCallId: string) => {
        if (state.session.pendingQuestion.value?.toolCallId === toolCallId) {
          state.session.pendingQuestion.value = null
        }
      },
    )
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'use the first option',
      mode: 'agent',
      model: 'openai::gpt-4o',
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'https://example.com/a.png',
        },
      ],
    })

    expect(state.session.submitAnswer).toHaveBeenCalledWith(
      'q-1',
      'use the first option',
    )
    expect(state.session.pendingQuestion.value).toBeNull()
    expect(attention.maybeClearAttentionWhenGatesEmpty).toHaveBeenCalledTimes(1)
    expect(state.messageQueue.enqueue).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('does not intercept internal sends while a question is pending', async () => {
    const state = buildState()
    state.session.pendingQuestion.value = {
      toolCallId: 'q-1',
      question: 'Which approach?',
    }
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'queued drain',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(state.session.submitAnswer).not.toHaveBeenCalled()
    expect(state.session.pendingQuestion.value).toEqual({
      toolCallId: 'q-1',
      question: 'Which approach?',
    })
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('falls through when the composer send is empty while a question is pending', async () => {
    const state = buildState()
    state.status.value = 'streaming'
    state.session.pendingQuestion.value = {
      toolCallId: 'q-1',
      question: 'Which approach?',
    }
    const attention = createHelpers(state)
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '   ',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.submitAnswer).not.toHaveBeenCalled()
    expect(state.session.pendingQuestion.value).toEqual({
      toolCallId: 'q-1',
      question: 'Which approach?',
    })
    expect(state.messageQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ text: '   ' }),
    )
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('normalizes image data-url parts before appending them', async () => {
    normalizeImageDataUrl.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAA',
          filename: 'shot.png',
        },
      ],
    })

    expect(normalizeImageDataUrl).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,AAA',
      mediaType: 'image/png',
    })
    expect(state.session.appendLocalMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'look' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,BBB',
            filename: 'shot.png',
          },
        ],
      }),
    )
  })

  it('adjusts the filename extension when normalized media type changes', async () => {
    normalizeImageDataUrl.mockResolvedValueOnce({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'image/webp',
          url: 'data:image/webp;base64,AAA',
          filename: 'shot.webp',
        },
      ],
    })

    expect(state.session.appendLocalMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'look' },
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,BBB',
            filename: 'shot.png',
          },
        ],
      }),
    )
  })

  it('leaves non-image file parts untouched', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'application/pdf',
          url: 'data:application/pdf;base64,AAA',
          filename: 'notes.pdf',
        },
      ],
    })

    expect(normalizeImageDataUrl).not.toHaveBeenCalled()
    expect(state.session.appendLocalMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          { type: 'text', text: 'look' },
          {
            type: 'file',
            mediaType: 'application/pdf',
            url: 'data:application/pdf;base64,AAA',
            filename: 'notes.pdf',
          },
        ],
      }),
    )
  })

  it('bails out when aborted while normalizing images', async () => {
    let resolveNormalize: (value: {
      dataUrl: string
      mediaType: string
    }) => void = () => undefined
    normalizeImageDataUrl.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveNormalize = resolve
      }),
    )
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const sending = send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAA',
          filename: 'shot.png',
        },
      ],
    })

    await vi.waitFor(() => {
      expect(normalizeImageDataUrl).toHaveBeenCalled()
      expect(state.abortController.value).not.toBeNull()
    })
    expect(state.status.value).toBe('submitted')

    state.abortController.value?.abort()
    state.status.value = 'ready'
    resolveNormalize({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    await sending

    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
    expect(state.abortController.value).toBeNull()
  })

  it('does not mark a prior turn or append a user message when image normalize fails', async () => {
    normalizeImageDataUrl.mockRejectedValueOnce(
      new Error('Image could not be compressed under the 3.75MB provider limit'),
    )
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAA',
          filename: 'shot.png',
        },
      ],
    })

    expect(toastError).toHaveBeenCalledWith(
      'Could not attach image',
      expect.objectContaining({
        description: 'Image could not be compressed under the 3.75MB provider limit',
      }),
    )
    expect(toastError).not.toHaveBeenCalledWith(
      'Agent run failed',
      expect.anything(),
    )
    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(state.session.setAgentTurnError).not.toHaveBeenCalled()
    expect(state.session.finishAgentTurn).not.toHaveBeenCalled()
    expect(attention.applyTurnEndAttention).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
  })

  it('still records a turn error when the orchestrator fails after start', async () => {
    runOrchestrator.mockRejectedValueOnce(new Error('provider down'))
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
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

    expect(state.session.startAgentTurn).toHaveBeenCalledTimes(1)
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'provider down',
      }),
    )
    expect(state.session.finishAgentTurn).toHaveBeenCalledTimes(1)
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description: 'provider down' }),
    )
  })
})
