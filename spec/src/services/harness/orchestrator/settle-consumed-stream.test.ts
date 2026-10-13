import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModelUsage, ModelMessage } from 'ai'
import { settleConsumedStream } from '@/services/harness/orchestrator/settle-consumed-stream'
import {
  getTurnResponseMessages,
  register,
  resetSubagentRegistryForTests,
  resolve,
  setTurnResponseMessages,
} from '@/services/harness/subagent/registry'

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() },
}))

const spawnResultMessage = (toolCallId: string): ModelMessage => ({
  role: 'tool',
  content: [
    {
      type: 'tool-result',
      toolCallId,
      toolName: 'spawn_subagent',
      output: { type: 'json', value: { pending: true } },
    },
  ],
})

const settle = async (args: {
  chatId?: string
  captureTurnMessages?: boolean
  responseMessages: ModelMessage[]
}): Promise<void> => {
  await settleConsumedStream({
    signal: new AbortController().signal,
    streamError: null,
    result: {
      usage: Promise.resolve({
        inputTokens: 1,
        inputTokenDetails: {
          noCacheTokens: 1,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokens: 1,
        outputTokenDetails: {
          textTokens: 1,
          reasoningTokens: undefined,
        },
        totalTokens: 2,
        raw: undefined,
      } satisfies LanguageModelUsage),
      text: Promise.resolve(''),
      responseMessages: Promise.resolve(args.responseMessages),
    },
    steps: {
      trailingText: 'done',
      collectedStepText: 'done',
    },
    lastStepHadTokens: true,
    modelId: 'qwen',
    captureUsage: async () => undefined,
    onEvent: () => undefined,
    captureTurnMessages: args.captureTurnMessages ?? true,
    chatId: args.chatId ?? 'chat-1',
    persistAssistant: async () => undefined,
    hitOutputLimit: false,
    maxOutputTokens: undefined,
    cutOffToolNames: [],
    lastFinishReason: 'stop',
    projectSlug: 'demo',
    emitTurnEnded: async () => undefined,
  })
}

describe('settleConsumedStream turn snapshot capture', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('does not capture a non-spawn user turn while a pending wake is still set', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })

    await settle({
      responseMessages: [{ role: 'assistant', content: 'later user reply' }],
    })

    expect(getTurnResponseMessages('chat-1')).toBeNull()
  })

  it('captures the snapshot when this turn spawned a background subagent', async () => {
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    const responseMessages = [spawnResultMessage('tc-2')]

    await settle({ responseMessages })

    expect(getTurnResponseMessages('chat-1')).toEqual(responseMessages)
  })

  it('still captures after the spawned background subagent finishes during the turn', async () => {
    register('chat-1', 'sub-2', new AbortController(), {
      toolCallId: 'tc-2',
      agentName: 'writer',
    })
    resolve('sub-2', {
      subagentId: 'sub-2',
      name: 'writer',
      summary: 'drafted the patch',
    })
    const responseMessages = [spawnResultMessage('tc-2')]

    await settle({ responseMessages })

    expect(getTurnResponseMessages('chat-1')).toEqual(responseMessages)
  })

  it('does not treat a blocking spawn on a later user turn as the wake snapshot', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    register(
      'chat-1',
      'sub-block',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocker' },
      { pendingResume: false },
    )

    await settle({
      responseMessages: [spawnResultMessage('tc-block')],
    })

    expect(getTurnResponseMessages('chat-1')).toBeNull()
  })

  it('does not overwrite a snapshot already captured by the spawn-wave turn', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    const wave1 = [spawnResultMessage('tc-1')]
    setTurnResponseMessages('chat-1', wave1)

    await settle({
      responseMessages: [{ role: 'assistant', content: 'later user reply' }],
    })

    expect(getTurnResponseMessages('chat-1')).toEqual(wave1)
  })
})
