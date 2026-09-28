import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { FileUIPart, UIMessage } from 'ai'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { AgentHarnessState } from '@/composables/agent-harness/types'

const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const toastSuccess = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

vi.mock('@/services/harness/restore-file-checkpoints', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  aggregateTurnFileDiffs: vi.fn<() => unknown[]>(),
  collectMutationsAfterUserMessage: vi.fn<() => unknown[]>(),
  resolveBaselinesForAgentTurn: vi.fn<() => unknown>(),
  resolveBaselinesForRevert: vi.fn<() => unknown[]>(),
}))

import createPersistence from '@/composables/agent-harness/persistence'
import useContextUsage from '@/composables/use-context-usage'
import restoreFileCheckpoints, {
  collectMutationsAfterUserMessage,
  resolveBaselinesForAgentTurn,
} from '@/services/harness/restore-file-checkpoints'

const imageFile: FileUIPart = {
  type: 'file',
  mediaType: 'image/png',
  url: 'data:image/png;base64,AAA',
  filename: 'shot.png',
}

const buildState = (
  lastUser: UIMessage | null,
  continuableTurn: AgentTurn | null = null,
): AgentHarnessState =>
  ({
    options: {
      projectSlug: 'proj',
      chatId: 'chat-1',
      projectRoot: '/tmp/proj',
      projectName: 'proj',
      standalone: false,
    },
    session: {
      getLastUserMessage: () => lastUser,
      getContinuableTurn: () => continuableTurn,
      truncateAfterLastUserMessage: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      truncateBeforeMessage: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      truncateAfterUserMessage: vi
        .fn<(...args: unknown[]) => Promise<void>>()
        .mockResolvedValue(undefined),
      timeline: ref(
        lastUser ? [{ type: 'user' as const, message: lastUser }] : [],
      ),
    },
    status: ref('ready'),
    workbench: {
      reloadWorkspaceFiles: vi.fn<(paths: string[]) => void>(),
    },
    disposed: ref(false),
    contextUsage: useContextUsage(),
    chatStore: {
      editingMessageId: ref(lastUser?.id ?? null),
      cancelEditMessage: vi.fn<() => void>(),
      isSessionActive: () => true,
    },
  }) as unknown as AgentHarnessState

const seedEstimateWithStaleProviderFill = (estimated = 5_000) => {
  const contextUsage = useContextUsage()
  contextUsage.setBudget({
    modelId: 'test-model',
    limit: 262_000,
    promptUsed: estimated,
    reservedOutput: 33_000,
    safetyBuffer: 2_000,
    free: 262_000 - 33_000 - 2_000 - estimated,
    used: estimated,
    buckets: [{ id: 'messages', label: 'Conversation', tokens: estimated }],
  })
  contextUsage.setLastStepUsage({
    promptTokens: 51_000,
    inputTokens: 51_000,
    outputTokens: 1_200,
    cacheReadTokens: 47_000,
    cacheWriteTokens: 0,
  })
  return contextUsage
}

describe('retryLastTurn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('retries an image-only last user message with its file parts', async () => {
    const lastUser: UIMessage = {
      id: 'user-image',
      role: 'user',
      parts: [imageFile],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const persistence = createPersistence(buildState(lastUser), { send })

    await persistence.retryLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).toHaveBeenCalledWith({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      reasoning: undefined,
      files: [imageFile],
      skipUserMessage: true,
      skipUserPersist: true,
      appendedUserMessageId: 'user-image',
      internal: true,
    })
  })

  it('retries a text last user message without attaching files', async () => {
    const lastUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: '  hello  ' }],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const persistence = createPersistence(buildState(lastUser), { send })

    await persistence.retryLastTurn({
      mode: 'plan',
      model: 'openai::gpt-4o',
      reasoning: 'high',
    })

    expect(send).toHaveBeenCalledWith({
      text: 'hello',
      mode: 'plan',
      model: 'openai::gpt-4o',
      reasoning: 'high',
      skipUserMessage: true,
      skipUserPersist: true,
      appendedUserMessageId: 'user-text',
      internal: true,
    })
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('files')
  })

  it('does not send when the last user message has no text and no files', async () => {
    const lastUser: UIMessage = {
      id: 'user-empty',
      role: 'user',
      parts: [{ type: 'text', text: '   ' }],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const persistence = createPersistence(buildState(lastUser), { send })

    await persistence.retryLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not send while the parent turn is in flight', async () => {
    const lastUser: UIMessage = {
      id: 'user-image',
      role: 'user',
      parts: [imageFile],
    }
    const state = buildState(lastUser)
    state.status.value = 'streaming'
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const persistence = createPersistence(state, { send })

    await persistence.retryLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('clears provider fill after truncate so promptUsed falls back to the estimate', async () => {
    const lastUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: 'retry me' }],
    }
    const contextUsage = seedEstimateWithStaleProviderFill()
    expect(contextUsage.promptUsed.value).toBe(51_000)

    const persistence = createPersistence(buildState(lastUser), {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await persistence.retryLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(5_000)
  })

  it('does not clear provider fill when retry does not truncate', async () => {
    const lastUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: 'retry me' }],
    }
    const contextUsage = seedEstimateWithStaleProviderFill()
    const state = buildState(lastUser)
    state.status.value = 'streaming'
    const persistence = createPersistence(state, {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await persistence.retryLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.truncateAfterLastUserMessage).not.toHaveBeenCalled()
    expect(contextUsage.lastStepUsage.value?.inputTokens).toBe(51_000)
    expect(contextUsage.promptUsed.value).toBe(51_000)
  })
})

describe('continueLastTurn', () => {
  const lastUser: UIMessage = {
    id: 'user-text',
    role: 'user',
    parts: [{ type: 'text', text: 'hello' }],
  }
  const continuableTurn: AgentTurn = {
    id: 'turn-err',
    steps: [],
    text: 'partial answer',
    createdAt: '2026-01-01T00:00:00.000Z',
    error: { kind: 'error', message: 'provider down' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls send with continueTurnId and does not truncate or clear provider fill', async () => {
    const contextUsage = seedEstimateWithStaleProviderFill()
    expect(contextUsage.promptUsed.value).toBe(51_000)
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser, continuableTurn)
    const persistence = createPersistence(state, { send })

    await persistence.continueLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
      reasoning: 'high',
    })

    expect(send).toHaveBeenCalledWith({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      reasoning: 'high',
      continueTurnId: 'turn-err',
      appendedUserMessageId: 'user-text',
      skipUserMessage: true,
      skipUserPersist: true,
      internal: true,
    })
    expect(state.session.truncateAfterLastUserMessage).not.toHaveBeenCalled()
    expect(state.session.truncateAfterUserMessage).not.toHaveBeenCalled()
    expect(state.session.truncateBeforeMessage).not.toHaveBeenCalled()
    expect(contextUsage.lastStepUsage.value?.inputTokens).toBe(51_000)
    expect(contextUsage.promptUsed.value).toBe(51_000)
  })

  it('does not send when getContinuableTurn returns null', async () => {
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const persistence = createPersistence(buildState(lastUser), { send })

    await persistence.continueLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).not.toHaveBeenCalled()
  })

  it('does not send while the parent turn is in flight', async () => {
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser, continuableTurn)
    state.status.value = 'streaming'
    const persistence = createPersistence(state, { send })

    await persistence.continueLastTurn({
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).not.toHaveBeenCalled()
  })
})

describe('getLastTurnFileMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('delegates to collectMutationsAfterUserMessage with the last user message id', () => {
    const lastUser: UIMessage = {
      id: 'user-last',
      role: 'user',
      parts: [{ type: 'text', text: 'retry' }],
    }
    const preview = [
      { path: 'late-sub.ts', operation: 'create' as const, additions: 1, deletions: 0 },
    ]
    vi.mocked(collectMutationsAfterUserMessage).mockReturnValue(preview)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    expect(persistence.getLastTurnFileMutations()).toEqual(preview)
    expect(collectMutationsAfterUserMessage).toHaveBeenCalledWith(
      state.session.timeline.value,
      'user-last',
    )
  })

  it('returns an empty list when there is no last user message', () => {
    const persistence = createPersistence(buildState(null), {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    expect(persistence.getLastTurnFileMutations()).toEqual([])
    expect(collectMutationsAfterUserMessage).not.toHaveBeenCalled()
  })
})

describe('submitEditMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resends an image-only edited message with its file parts and no text', async () => {
    const lastUser: UIMessage = {
      id: 'user-image',
      role: 'user',
      parts: [imageFile],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, { send })

    await persistence.submitEditMessage({
      newContent: '   ',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.truncateAfterUserMessage).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'user-image',
    )
    expect(state.session.truncateBeforeMessage).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      reasoning: undefined,
      files: [imageFile],
      skipUserMessage: true,
      skipUserPersist: true,
      appendedUserMessageId: 'user-image',
      internal: true,
    })
    expect(send.mock.calls[0]?.[0]).not.toMatchObject({
      text: 'See attached image(s).',
    })
  })

  it('preserves original file parts when the edited text is not empty', async () => {
    const lastUser: UIMessage = {
      id: 'user-mixed',
      role: 'user',
      parts: [{ type: 'text', text: 'old caption' }, imageFile],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, { send })

    await persistence.submitEditMessage({
      newContent: 'new caption',
      mode: 'plan',
      model: 'openai::gpt-4o',
      reasoning: 'high',
    })

    expect(state.session.truncateBeforeMessage).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'user-mixed',
    )
    expect(state.session.truncateAfterUserMessage).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      text: 'new caption',
      mode: 'plan',
      model: 'openai::gpt-4o',
      reasoning: 'high',
      files: [imageFile],
      internal: true,
    })
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('skipUserMessage')
  })

  it('does not reuse the old message when a captioned image is edited to empty text', async () => {
    const lastUser: UIMessage = {
      id: 'user-mixed',
      role: 'user',
      parts: [{ type: 'text', text: 'old caption' }, imageFile],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, { send })

    await persistence.submitEditMessage({
      newContent: '   ',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.truncateBeforeMessage).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'user-mixed',
    )
    expect(state.session.truncateAfterUserMessage).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith({
      text: '',
      mode: 'agent',
      model: 'openai::gpt-4o',
      reasoning: undefined,
      files: [imageFile],
      internal: true,
    })
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('skipUserMessage')
    expect(send.mock.calls[0]?.[0]).not.toHaveProperty('appendedUserMessageId')
  })

  it('toasts and does not send when the edited message has no text and no files', async () => {
    const lastUser: UIMessage = {
      id: 'user-empty',
      role: 'user',
      parts: [{ type: 'text', text: '   ' }],
    }
    const send = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, { send })

    await persistence.submitEditMessage({
      newContent: '   ',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(send).not.toHaveBeenCalled()
    expect(state.session.truncateBeforeMessage).not.toHaveBeenCalled()
    expect(state.session.truncateAfterUserMessage).not.toHaveBeenCalled()
    expect(state.chatStore.cancelEditMessage).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('Message cannot be empty')
  })

  it('clears provider fill after truncate so promptUsed falls back to the estimate', async () => {
    const lastUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: 'old text' }],
    }
    const contextUsage = seedEstimateWithStaleProviderFill()
    expect(contextUsage.promptUsed.value).toBe(51_000)
    const state = buildState(lastUser)
    const persistence = createPersistence(state, {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    await persistence.submitEditMessage({
      newContent: 'new text',
      mode: 'agent',
      model: 'openai::gpt-4o',
    })

    expect(state.session.truncateBeforeMessage).toHaveBeenCalled()
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(5_000)
  })
})

describe('restoreAgentTurnFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears provider fill after truncate so promptUsed falls back to the estimate', async () => {
    const lastUser: UIMessage = {
      id: 'user-text',
      role: 'user',
      parts: [{ type: 'text', text: 'restore after this' }],
    }
    const contextUsage = seedEstimateWithStaleProviderFill()
    expect(contextUsage.promptUsed.value).toBe(51_000)
    vi.mocked(resolveBaselinesForAgentTurn).mockReturnValue({
      precedingUserMessageId: 'user-text',
      targets: [{ path: 'a.ts', userMessageId: 'user-text' }],
    })
    vi.mocked(restoreFileCheckpoints).mockResolvedValue({
      errors: [],
      restored: [],
      deleted: [],
      skipped: [],
    })
    const state = buildState(lastUser)
    const persistence = createPersistence(state, {
      send: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined),
    })

    const ok = await persistence.restoreAgentTurnFiles('turn-1')

    expect(ok).toBe(true)
    expect(state.session.truncateAfterUserMessage).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      'user-text',
    )
    expect(contextUsage.lastStepUsage.value).toBeNull()
    expect(contextUsage.promptUsed.value).toBe(5_000)
  })
})

