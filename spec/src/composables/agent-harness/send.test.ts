import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const continueOrchestrator = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
)
const listConfiguredProviders = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => string[]>(() => ['openai']),
)
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const toastInfo = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
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
  continueOrchestrator: (...args: unknown[]) => continueOrchestrator(...args),
}))

vi.mock('@/services/providers/list-configured-providers', () => ({
  default: (...args: unknown[]) => listConfiguredProviders(...args),
}))

const listSlashSkillIndex = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]),
)

vi.mock('@/services/skills/skill-registry', () => ({
  listSlashSkillIndex: (...args: unknown[]) => listSlashSkillIndex(...args),
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

const hasPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => boolean>(() => false),
)
const hasRunningSubagentsForChat = vi.hoisted(() =>
  vi.fn<(chatId: string) => boolean>(() => false),
)
const flushPendingBackgroundResume = vi.hoisted(() =>
  vi.fn<(chatId: string) => void>(),
)

vi.mock('@/services/harness/subagent/registry', () => ({
  hasPendingBackgroundResume: (chatId: string) =>
    hasPendingBackgroundResume(chatId),
  hasRunningSubagentsForChat: (chatId: string) =>
    hasRunningSubagentsForChat(chatId),
}))

vi.mock('@/services/harness/subagent/flush-pending-resume', () => ({
  default: (chatId: string) => flushPendingBackgroundResume(chatId),
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
    info: (...args: unknown[]) => toastInfo(...args),
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
  const resumeAgentTurn = vi.fn<(turnId: string) => void>()
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
      resumeAgentTurn,
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
    suppressQueueDrainAfterStop: ref(false),
    pendingApprovals: ref([]),
    pendingMcpAuth: ref([]),
    chatStore: {
      isSessionActive: vi.fn<() => boolean>().mockReturnValue(true),
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
    continueOrchestrator.mockResolvedValue(undefined)
    listConfiguredProviders.mockReturnValue(['openai'])
    listAgentIndex.mockResolvedValue([])
    listSlashSkillIndex.mockResolvedValue([])
    resolveAgentDefinition.mockResolvedValue(null)
    loadEffectiveSettings.mockResolvedValue({ version: 1 })
    hasPendingBackgroundResume.mockReturnValue(false)
    hasRunningSubagentsForChat.mockReturnValue(false)
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
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(state.lastRunConfig.value).toBeNull()
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
    expect(listAgentIndex).toHaveBeenCalledWith('/tmp/proj')
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ settings: personalSettings }),
    )
  })

  it('lists slash skills from the workspace root on standalone chats', async () => {
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
    })

    expect(loadEffectiveSettings).toHaveBeenCalledWith(null)
    expect(listSlashSkillIndex).toHaveBeenCalledWith('/tmp/proj')
    expect(listAgentIndex).toHaveBeenCalledWith('/tmp/proj')
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

  it('appends image-only user messages with file parts and no text', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '',
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

    expect(state.session.appendLocalMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        parts: [
          {
            type: 'file',
            mediaType: 'image/png',
            url: 'data:image/png;base64,AAA',
            filename: 'shot.png',
          },
        ],
      }),
    )
    const appended = vi.mocked(state.session.appendLocalMessage).mock.calls[0]?.[0] as {
      id: string
      parts: unknown[]
    }
    expect(appended.parts.some((part) => (part as { type: string }).type === 'text')).toBe(
      false,
    )
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        userText: '',
        appendedUserMessageId: appended.id,
      }),
    )
  })

  it('does not start a turn when empty text and all files are dropped', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '   ',
      mode: 'agent',
      model: 'openai::gpt-4o',
      internal: true,
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: '',
          filename: 'shot.png',
        },
      ],
    })

    expect(toastError).toHaveBeenCalledWith('Nothing to send', {
      description: 'Attachments could not be restored.',
    })
    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
    expect(state.fleetSidebar.refreshSlug).toHaveBeenCalledWith('proj')
  })

  it('does not start an internal skip-user turn with no text or files', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      internal: true,
    })

    expect(toastError).toHaveBeenCalledWith('Nothing to send', {
      description: 'Attachments could not be restored.',
    })
    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
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
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
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
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
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

  it('maps image rejection payload errors to a vision-capability hint', async () => {
    runOrchestrator.mockRejectedValueOnce(
      new Error('The image was not allowed to be used with this model'),
    )
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

    const description =
      'The selected model or provider rejected the image input. Switch to a vision-capable model or remove the image.'
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith({
      kind: 'error',
      message: description,
    })
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description }),
    )
  })

  it('maps malformed image_url payload errors without a vision-capability hint', async () => {
    runOrchestrator.mockRejectedValueOnce(
      new Error(
        "Invalid 'input[18].content[1].image_url'. Expected a valid URL, but got a value with an invalid format.",
      ),
    )
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

    const description =
      'An image in this conversation could not be read by the provider. Remove the image and attach it again.'
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith({
      kind: 'error',
      message: description,
    })
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description }),
    )
    expect(description).not.toContain('vision-capable')
  })

  it('maps other invalid json payload errors without image-size advice', async () => {
    const providerMessage =
      'AI_InvalidResponseBodyError: Invalid JSON response body: schema mismatch'
    runOrchestrator.mockRejectedValueOnce(new Error(providerMessage))
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

    const description = `${providerMessage} The provider rejected the request payload.`
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith({
      kind: 'error',
      message: description,
    })
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description }),
    )
    expect(description).not.toContain('Try smaller')
  })

  it('does not enqueue a user send while waiting on background subagents', async () => {
    const state = buildState()
    const attention = buildAttention()
    attention.isWaitingOnBackground = () => true
    attention.isParentBusy = () => false
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
    })

    expect(state.messageQueue.enqueue).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('keeps running subagents when a new parent send starts', async () => {
    const state = buildState()
    state.subagents.value = [
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
      {
        subagentId: 'done-1',
        name: 'reviewer',
        blocking: false,
        status: 'done',
        events: [],
      },
    ]
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

    expect(state.subagents.value).toEqual([
      expect.objectContaining({
        subagentId: 'run-1',
        status: 'running',
      }),
    ])
  })

  it('enqueues without a queue-full toast', async () => {
    const state = buildState()
    const attention = buildAttention()
    attention.isParentBusy = () => true
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    for (let index = 0; index < 12; index += 1) {
      await send({
        text: `queued-${index}`,
        mode: 'agent',
        model: 'openai::gpt-4o',
      })
    }

    expect(state.messageQueue.enqueue).toHaveBeenCalledTimes(12)
    expect(toastError).not.toHaveBeenCalledWith(
      'Queue is full',
      expect.anything(),
    )
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('flushes pending background resume when a user send starts a turn', async () => {
    hasPendingBackgroundResume.mockReturnValue(true)
    const state = buildState()
    state.subagents.value = [
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
    ]
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
    })

    expect(state.session.startAgentTurn).toHaveBeenCalledTimes(1)
    expect(flushPendingBackgroundResume).toHaveBeenCalledWith('chat-1')
    expect(flushPendingBackgroundResume.mock.invocationCallOrder[0]).toBeGreaterThan(
      vi.mocked(state.session.startAgentTurn).mock.invocationCallOrder[0] ?? 0,
    )
    expect(state.messageQueue.enqueue).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.subagents.value).toEqual([
      expect.objectContaining({
        subagentId: 'run-1',
        status: 'running',
      }),
    ])
  })

  it('leaves pending background resume intact when attachment normalize fails after submitted', async () => {
    hasPendingBackgroundResume.mockReturnValue(true)
    normalizeImageDataUrl.mockRejectedValueOnce(
      new Error('Image could not be compressed under the 3.75MB provider limit'),
    )
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
      files: [
        {
          type: 'file',
          mediaType: 'image/png',
          url: 'data:image/png;base64,AAA',
          filename: 'shot.png',
        },
      ],
    })

    expect(state.status.value).toBe('ready')
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('does not clear stop-queue suppression when enqueueing while busy', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
    const attention = buildAttention()
    attention.isParentBusy = () => true
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'queued after stop',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.messageQueue.enqueue).toHaveBeenCalled()
    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('does not clear stop-queue suppression on a failed send', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: '',
    })

    expect(toastError).toHaveBeenCalledWith('Select a model before sending')
    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('does not clear stop-queue suppression when answering ask_user', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
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
      text: 'use the first option',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.submitAnswer).toHaveBeenCalledWith(
      'q-1',
      'use the first option',
    )
    expect(state.suppressQueueDrainAfterStop.value).toBe(true)
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('clears stop-queue suppression when a new turn starts', async () => {
    const state = buildState()
    state.suppressQueueDrainAfterStop.value = true
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

    expect(state.session.startAgentTurn).toHaveBeenCalledTimes(1)
    expect(state.suppressQueueDrainAfterStop.value).toBe(false)
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('does not flush pending resume on an internal send', async () => {
    hasPendingBackgroundResume.mockReturnValue(true)
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

    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
  })

  it('enqueues when a background resume starts during settings load', async () => {
    const state = buildState()
    const resumeAbort = new AbortController()
    loadEffectiveSettings.mockImplementation(async () => {
      state.resumingBackgroundBatch.value = true
      state.status.value = 'submitted'
      state.abortController.value = resumeAbort
      return { version: 1 }
    })
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
    })

    expect(state.messageQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'hello' }),
    )
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.abortController.value).toBe(resumeAbort)
    expect(state.status.value).toBe('submitted')
    expect(state.resumingBackgroundBatch.value).toBe(true)
  })

  it('does not flush pending resume when resume starts during send prep', async () => {
    hasPendingBackgroundResume.mockReturnValue(true)
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
    const resumeAbort = new AbortController()
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const sending = send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
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
    const sendAbort = state.abortController.value
    state.resumingBackgroundBatch.value = true
    state.abortController.value = resumeAbort
    resolveNormalize({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    await sending

    expect(state.messageQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'look',
        skipUserMessage: true,
        skipUserPersist: true,
      }),
    )
    expect(state.session.appendLocalMessage).toHaveBeenCalledTimes(1)
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.abortController.value).toBe(resumeAbort)
    expect(state.abortController.value).not.toBe(sendAbort)
    expect(state.status.value).toBe('submitted')
  })

  it('replays a defer after persist without a duplicate user message', async () => {
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
    const resumeAbort = new AbortController()
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const sending = send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
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
    })
    state.resumingBackgroundBatch.value = true
    state.abortController.value = resumeAbort
    resolveNormalize({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    await sending

    const queued = vi.mocked(state.messageQueue.enqueue).mock.calls[0]?.[0] as {
      text: string
      files: unknown[]
      mode: 'agent'
      model: string
      skipUserMessage?: boolean
      skipUserPersist?: boolean
      appendedUserMessageId?: string
    }
    expect(queued.skipUserMessage).toBe(true)
    expect(queued.skipUserPersist).toBe(true)
    expect(queued.appendedUserMessageId).toEqual(expect.any(String))
    expect(state.session.appendLocalMessage).toHaveBeenCalledTimes(1)

    state.resumingBackgroundBatch.value = false
    state.status.value = 'ready'
    state.abortController.value = null
    await send({
      text: queued.text,
      files: queued.files as [],
      mode: queued.mode,
      model: queued.model,
      skipUserMessage: queued.skipUserMessage,
      skipUserPersist: queued.skipUserPersist,
      appendedUserMessageId: queued.appendedUserMessageId,
      internal: true,
    })

    expect(state.session.appendLocalMessage).toHaveBeenCalledTimes(1)
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        skipUserPersist: true,
        appendedUserMessageId: queued.appendedUserMessageId,
      }),
    )
  })

  it('appends the user message once when a defer happens before persist', async () => {
    const state = buildState()
    const resumeAbort = new AbortController()
    loadEffectiveSettings.mockImplementationOnce(async () => {
      state.resumingBackgroundBatch.value = true
      state.status.value = 'submitted'
      state.abortController.value = resumeAbort
      return { version: 1 }
    })
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    const queued = vi.mocked(state.messageQueue.enqueue).mock.calls[0]?.[0] as {
      text: string
      files: unknown[]
      mode: 'agent'
      model: string
      skipUserMessage?: boolean
      skipUserPersist?: boolean
    }
    expect(queued.skipUserMessage).toBeUndefined()
    expect(queued.skipUserPersist).toBeUndefined()
    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()

    state.resumingBackgroundBatch.value = false
    state.status.value = 'ready'
    state.abortController.value = null
    await send({
      text: queued.text,
      files: queued.files as [],
      mode: queued.mode,
      model: queued.model,
      skipUserMessage: queued.skipUserMessage,
      skipUserPersist: queued.skipUserPersist,
      internal: true,
    })

    expect(state.session.appendLocalMessage).toHaveBeenCalledTimes(1)
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ skipUserPersist: undefined }),
    )
  })

  it('starts immediately while background subagents are running and not resuming', async () => {
    hasRunningSubagentsForChat.mockReturnValue(true)
    const state = buildState()
    state.subagents.value = [
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
    ]
    const attention = createHelpers(state)
    expect(attention.isWaitingOnBackground()).toBe(true)
    expect(attention.isParentBusy()).toBe(false)
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
    })

    expect(state.messageQueue.enqueue).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).toHaveBeenCalledTimes(1)
    expect(flushPendingBackgroundResume).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.subagents.value).toEqual([
      expect.objectContaining({
        subagentId: 'run-1',
        status: 'running',
      }),
    ])
  })

  it('defers an internal send while compacting instead of overlapping', async () => {
    const state = buildState()
    state.compacting.value = true
    const priorConfig = {
      mode: 'plan' as const,
      model: 'openai::gpt-4.1',
      mentions: [],
      effectiveSettings: { version: 1 as const },
    }
    state.lastRunConfig.value = priorConfig
    state.subagents.value = [
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
      {
        subagentId: 'done-1',
        name: 'reviewer',
        blocking: false,
        status: 'done',
        events: [],
      },
    ]
    const { send } = createSend(state, createHelpers(state), {
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

    expect(state.messageQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'queued drain', skipUserMessage: true }),
    )
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(state.session.patchMeta).not.toHaveBeenCalled()
    expect(state.lastRunConfig.value).toEqual(priorConfig)
    expect(state.subagents.value).toHaveLength(2)
    expect(state.status.value).toBe('ready')
  })

  it('keeps skipUserPersist on a deferred retry replay', async () => {
    const state = buildState()
    state.compacting.value = true
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: 'retry me',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      skipUserPersist: true,
      internal: true,
    })

    const queued = vi.mocked(state.messageQueue.enqueue).mock.calls[0]?.[0] as {
      text: string
      files: unknown[]
      mode: 'agent'
      model: string
      skipUserMessage?: boolean
      skipUserPersist?: boolean
    }
    expect(queued.skipUserMessage).toBe(true)
    expect(queued.skipUserPersist).toBe(true)
    expect(runOrchestrator).not.toHaveBeenCalled()

    state.compacting.value = false
    state.status.value = 'ready'
    state.abortController.value = null
    await send({
      text: queued.text,
      files: queued.files as [],
      mode: queued.mode,
      model: queued.model,
      skipUserMessage: queued.skipUserMessage,
      skipUserPersist: queued.skipUserPersist,
      internal: true,
    })

    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(runOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({ skipUserPersist: true }),
    )
  })

  it('leaves lastRunConfig, subagents, and chat meta untouched when a send defers', async () => {
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
    const priorConfig = {
      mode: 'plan' as const,
      model: 'openai::gpt-4.1',
      mentions: [],
      effectiveSettings: { version: 1 as const },
    }
    state.lastRunConfig.value = priorConfig
    state.subagents.value = [
      {
        subagentId: 'run-1',
        name: 'explorer',
        blocking: false,
        status: 'running',
        events: [],
      },
      {
        subagentId: 'done-1',
        name: 'reviewer',
        blocking: false,
        status: 'done',
        events: [],
      },
    ]
    const resumeAbort = new AbortController()
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const sending = send({
      text: 'look',
      mode: 'agent',
      model: 'openai::gpt-4o',
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
    })
    state.resumingBackgroundBatch.value = true
    state.abortController.value = resumeAbort
    resolveNormalize({
      dataUrl: 'data:image/png;base64,BBB',
      mediaType: 'image/png',
    })
    await sending

    expect(state.messageQueue.enqueue).toHaveBeenCalled()
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(state.session.patchMeta).not.toHaveBeenCalled()
    expect(state.lastRunConfig.value).toEqual(priorConfig)
    expect(state.subagents.value).toHaveLength(2)
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
  })
})

describe('agent-harness send continue', () => {
  const continueArgs = {
    text: '',
    mode: 'agent' as const,
    model: 'openai::gpt-4o',
    continueTurnId: 'turn-err',
    appendedUserMessageId: 'user-1',
    skipUserMessage: true,
    skipUserPersist: true,
    internal: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    runOrchestrator.mockResolvedValue(undefined)
    continueOrchestrator.mockResolvedValue(undefined)
    listConfiguredProviders.mockReturnValue(['openai'])
    listAgentIndex.mockResolvedValue([])
    listSlashSkillIndex.mockResolvedValue([])
    resolveAgentDefinition.mockResolvedValue(null)
    loadEffectiveSettings.mockResolvedValue({ version: 1 })
    hasPendingBackgroundResume.mockReturnValue(false)
    hasRunningSubagentsForChat.mockReturnValue(false)
  })

  it('resumes the existing turn and calls continueOrchestrator', async () => {
    const state = buildState()
    const { send } = createSend(state, buildAttention(), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send(continueArgs)

    expect(state.session.resumeAgentTurn).toHaveBeenCalledWith('turn-err')
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(state.session.appendLocalMessage).not.toHaveBeenCalled()
    expect(continueOrchestrator).toHaveBeenCalledTimes(1)
    expect(continueOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: 'turn-err',
        userMessageId: 'user-1',
      }),
    )
    expect(continueOrchestrator.mock.calls[0]?.[0]).not.toHaveProperty('userText')
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
  })

  it('sets the turn error when continueOrchestrator rejects', async () => {
    continueOrchestrator.mockRejectedValueOnce(new Error('provider down'))
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send(continueArgs)

    expect(state.session.resumeAgentTurn).toHaveBeenCalledWith('turn-err')
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'provider down',
      }),
    )
    expect(state.session.finishAgentTurn).toHaveBeenCalledTimes(1)
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(state.status.value).toBe('error')
    expect(runOrchestrator).not.toHaveBeenCalled()
  })

  it('sets the turn error when continue has no user message id', async () => {
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      continueTurnId: 'turn-err',
      skipUserMessage: true,
      skipUserPersist: true,
      internal: true,
    })

    expect(state.session.resumeAgentTurn).toHaveBeenCalledWith('turn-err')
    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'Cannot continue turn without a user message id',
      }),
    )
    expect(state.status.value).toBe('error')
  })

  it('toasts and does not enqueue when compacting', async () => {
    const state = buildState()
    state.compacting.value = true
    const { send } = createSend(state, createHelpers(state), {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
      maybeDrainQueue: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await send(continueArgs)

    expect(toastError).toHaveBeenCalledWith(
      'Chat is busy',
      expect.objectContaining({
        description: 'Wait for compaction or background resume to finish.',
      }),
    )
    expect(state.messageQueue.enqueue).not.toHaveBeenCalled()
    expect(state.session.resumeAgentTurn).not.toHaveBeenCalled()
    expect(state.session.startAgentTurn).not.toHaveBeenCalled()
    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).not.toHaveBeenCalled()
    expect(state.status.value).toBe('ready')
  })
})

describe('agent-harness send transient auto-retry', () => {
  const transientError = (): Error =>
    new Error('error sending request')

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    updateChatMeta.mockResolvedValue(undefined)
    runOrchestrator.mockResolvedValue(undefined)
    continueOrchestrator.mockResolvedValue(undefined)
    listConfiguredProviders.mockReturnValue(['openai'])
    listAgentIndex.mockResolvedValue([])
    listSlashSkillIndex.mockResolvedValue([])
    resolveAgentDefinition.mockResolvedValue(null)
    loadEffectiveSettings.mockResolvedValue({ version: 1 })
    hasPendingBackgroundResume.mockReturnValue(false)
    hasRunningSubagentsForChat.mockReturnValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('continues the turn after a transient error and skips the error UI', async () => {
    runOrchestrator.mockRejectedValueOnce(transientError())
    continueOrchestrator.mockResolvedValueOnce(undefined)
    const state = buildState()
    const attention = buildAttention()
    const maybeDrainQueue = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue,
    })

    const pending = send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    const turnId = vi.mocked(state.session.startAgentTurn).mock.calls[0]?.[0]
    expect(turnId).toEqual(expect.any(String))
    expect(toastInfo).toHaveBeenCalledWith('Connection dropped, retrying (1 of 2)')
    expect(state.session.resumeAgentTurn).toHaveBeenCalledWith(turnId)
    expect(continueOrchestrator).toHaveBeenCalledTimes(1)
    expect(continueOrchestrator).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: turnId,
        userMessageId: 'user-1',
      }),
    )
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.session.setAgentTurnError).not.toHaveBeenCalled()
    expect(attention.applyTurnEndAttention).toHaveBeenCalledTimes(1)
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('success')
    expect(toastError).not.toHaveBeenCalledWith(
      'Agent run failed',
      expect.anything(),
    )
    expect(state.status.value).toBe('ready')
    expect(maybeDrainQueue).toHaveBeenCalledTimes(1)
  })

  it('aborts during backoff without setting a turn error or continuing', async () => {
    runOrchestrator.mockRejectedValueOnce(transientError())
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    })

    const pending = send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
      internal: true,
    })
    await vi.waitFor(() => {
      expect(toastInfo).toHaveBeenCalled()
      expect(state.abortController.value).not.toBeNull()
    })
    state.abortController.value?.abort()
    await pending

    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.session.setAgentTurnError).not.toHaveBeenCalled()
    expect(attention.applyTurnEndAttention).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalledWith(
      'Agent run failed',
      expect.anything(),
    )
    expect(state.status.value).toBe('ready')
    expect(state.abortController.value).toBeNull()
  })

  it('does not retry a non-transient orchestrator error', async () => {
    runOrchestrator.mockRejectedValueOnce(new Error('provider down'))
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    })

    await send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
      internal: true,
    })

    expect(toastInfo).not.toHaveBeenCalled()
    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'provider down',
      }),
    )
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description: 'provider down' }),
    )
    expect(state.status.value).toBe('error')
  })

  it('falls through to the error UI after retries are exhausted', async () => {
    runOrchestrator.mockRejectedValueOnce(transientError())
    continueOrchestrator
      .mockRejectedValueOnce(transientError())
      .mockRejectedValueOnce(transientError())
    const state = buildState()
    const attention = buildAttention()
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
    })

    const pending = send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
      internal: true,
    })
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(6_000)
    await pending

    expect(toastInfo).toHaveBeenCalledWith('Connection dropped, retrying (1 of 2)')
    expect(toastInfo).toHaveBeenCalledWith('Connection dropped, retrying (2 of 2)')
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(continueOrchestrator).toHaveBeenCalledTimes(2)
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'error sending request',
      }),
    )
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description: 'error sending request' }),
    )
    expect(state.status.value).toBe('error')
  })

  it('surfaces the original error when compaction blocks the retry', async () => {
    runOrchestrator.mockRejectedValueOnce(transientError())
    const state = buildState()
    const attention = buildAttention()
    const maybeDrainQueue = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue,
    })

    const pending = send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
    })
    await vi.waitFor(() => {
      expect(toastInfo).toHaveBeenCalled()
    })
    state.compacting.value = true
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.session.resumeAgentTurn).not.toHaveBeenCalled()
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'error sending request',
      }),
    )
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description: 'error sending request' }),
    )
    expect(toastError).not.toHaveBeenCalledWith(
      'Chat is busy',
      expect.anything(),
    )
    expect(maybeDrainQueue).not.toHaveBeenCalled()
    expect(state.status.value).toBe('error')
  })

  it('surfaces the original error when background resume blocks the retry', async () => {
    runOrchestrator.mockRejectedValueOnce(transientError())
    const state = buildState()
    const attention = buildAttention()
    const maybeDrainQueue = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined)
    const { send } = createSend(state, attention, {
      handleEvent: vi.fn<(...args: unknown[]) => void>(),
      persistPermission: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      maybeDrainQueue,
    })

    const pending = send({
      text: 'hello',
      mode: 'agent',
      model: 'openai::gpt-4o',
      skipUserMessage: true,
      appendedUserMessageId: 'user-1',
    })
    await vi.waitFor(() => {
      expect(toastInfo).toHaveBeenCalled()
    })
    state.resumingBackgroundBatch.value = true
    await vi.advanceTimersByTimeAsync(2_000)
    await pending

    expect(continueOrchestrator).not.toHaveBeenCalled()
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    expect(state.session.resumeAgentTurn).not.toHaveBeenCalled()
    expect(state.session.setAgentTurnError).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'error',
        message: 'error sending request',
      }),
    )
    expect(attention.applyTurnEndAttention).toHaveBeenCalledWith('error')
    expect(toastError).toHaveBeenCalledWith(
      'Agent run failed',
      expect.objectContaining({ description: 'error sending request' }),
    )
    expect(toastError).not.toHaveBeenCalledWith(
      'Chat is busy',
      expect.anything(),
    )
    expect(maybeDrainQueue).not.toHaveBeenCalled()
    expect(state.status.value).toBe('submitted')
  })
})

