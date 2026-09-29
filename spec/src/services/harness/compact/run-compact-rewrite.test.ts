import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LanguageModel, ModelMessage, ToolSet } from 'ai'
import type { ModelRef } from '@/types/models/model-ref'
import { compactBudgets, estimatePromptTokens } from '@/services/harness/compact'

const generateCheckpoint = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

vi.mock('@/services/harness/compact/generate-checkpoint', () => ({
  default: (...args: unknown[]) => generateCheckpoint(...args),
}))

import runCompactRewrite from '@/services/harness/compact/run-compact-rewrite'

const model = { id: 'chat-model' } as unknown as LanguageModel
const modelRef: ModelRef = { providerId: 'local', modelId: 'qwen' }
const tools: ToolSet = {}
const hugeContent = 'x'.repeat(800_000)
const system = 'You are the parent agent.'
const highWater = 20_000

const checkpointInput = (messages: ModelMessage[], signal = new AbortController().signal) => ({
  model,
  modelRef,
  system,
  providerOptions: {},
  tools,
  messages,
  focus: 'parent',
  signal,
})

const completedWorkTurns = (count: number): ModelMessage[] => {
  const messages: ModelMessage[] = []
  for (let index = 0; index < count; index += 1) {
    messages.push({
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: `Completed step ${index}: inspected login refresh and drafted RCA notes.`,
        },
        {
          type: 'tool-call',
          toolCallId: `call-${index}`,
          toolName: 'read_file',
          input: { path: `src/auth/step-${index}.ts` },
        },
      ],
    })
    messages.push({
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: `call-${index}`,
          toolName: 'read_file',
          output: {
            type: 'text',
            value: `file body for step ${index}: token refresh handler`,
          },
        },
      ],
    })
  }
  return messages
}

const messageText = (message: ModelMessage | undefined): string => {
  if (!message || typeof message.content !== 'string') {
    return ''
  }
  return message.content
}

describe('runCompactRewrite', () => {
  beforeEach(() => {
    generateCheckpoint.mockReset()
  })

  it('returns the model summary when generation succeeds and the rewrite fits', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'Short recap',
      usage: { inputTokens: 2, outputTokens: 1 },
      providerMetadata: undefined,
      responseId: 'r1',
      modelRef,
    })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(result.summary).toBe('Short recap')
    expect(result.compacted?.responseId).toBe('r1')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('falls back when checkpoint generation fails', async () => {
    generateCheckpoint.mockRejectedValue(new Error('prompt is too long'))
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(generateCheckpoint).toHaveBeenCalledTimes(2)
    expect(result.compacted).toBeNull()
    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('retries once with a corrective note then keeps the second checkpoint', async () => {
    generateCheckpoint
      .mockRejectedValueOnce(new Error('Compaction returned empty summary'))
      .mockResolvedValueOnce({
        summary: 'Retry recap',
        usage: { inputTokens: 3, outputTokens: 2 },
        providerMetadata: undefined,
        responseId: 'r-retry',
        modelRef,
      })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(generateCheckpoint).toHaveBeenCalledTimes(2)
    expect(generateCheckpoint.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        messages: [
          ...messages,
          {
            role: 'user',
            content: expect.stringContaining(
              'Previous output was not a checkpoint',
            ),
          },
        ],
      }),
    )
    expect(result.summary).toBe('Retry recap')
    expect(result.compacted?.responseId).toBe('r-retry')
  })

  it('keeps the paid checkpoint when a huge model summary overflows and fallback persists', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'M'.repeat(800_000),
      usage: { inputTokens: 40, outputTokens: 20 },
      providerMetadata: { paid: true },
      responseId: 'r-paid',
      modelRef,
    })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: 'Inspecting token refresh.' },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(result.compacted?.responseId).toBe('r-paid')
    expect(result.compacted?.usage).toEqual({
      inputTokens: 40,
      outputTokens: 20,
    })
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('skips a doomed checkpoint request when the prompt is already over the hard window', async () => {
    const messages: ModelMessage[] = [
      { role: 'user', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
      hardWindow: 1_000,
    })

    expect(generateCheckpoint).not.toHaveBeenCalled()
    expect(result.compacted).toBeNull()
    expect(result.summary).toContain('Deterministic compaction fallback')
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('rewrites a finished-task transcript without dropping tail work for a screenshot question', async () => {
    const summary = [
      'Goal: Deliver RCA for the login refresh incident.',
      'Decisions: Fix token refresh before rewriting call sites.',
      'Files+symbols: src/auth/refresh.ts',
      'Errors+fixes: expired token handler was stale.',
      'Skills loaded: none',
      'Plan+todos: RCA delivered, regression written.',
      'Next: Resume from the unanswered screenshot question after this checkpoint.',
    ].join('\n')
    generateCheckpoint.mockResolvedValue({
      summary,
      usage: { inputTokens: 12, outputTokens: 8 },
      providerMetadata: undefined,
      responseId: 'r-transcript',
      modelRef,
    })

    const firstTaskText = `Please come up with an RCA\n${'email thread '.repeat(20_000)}`
    const firstTask: ModelMessage = { role: 'user', content: firstTaskText }
    const recapAssistant: ModelMessage = {
      role: 'assistant',
      content:
        'RCA is complete. Login refresh regression is in place. Waiting on your next question.',
    }
    const screenshotQuestion: ModelMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Does this screenshot match the RCA?',
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: 'A'.repeat(300_000),
        },
      ],
    }
    const messages: ModelMessage[] = [
      firstTask,
      ...completedWorkTurns(12),
      recapAssistant,
      screenshotQuestion,
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
    })

    const firstContent = messageText(result.messages[0])
    expect(result.messages[0]?.role).toBe('user')
    expect(firstContent.startsWith(compactBudgets.FIRST_USER_PREFIX)).toBe(true)
    expect(firstContent).toContain('Please come up with an RCA')
    expect(firstContent).toContain('[truncated for compaction]')
    expect(firstContent.length).toBeLessThan(firstTaskText.length / 10)
    expect(firstContent).not.toContain('email thread '.repeat(5_000))

    const serialized = JSON.stringify(result.messages)
    expect(serialized).not.toContain('A'.repeat(1000))
    expect(serialized).toContain('[image omitted by compaction]')
    expect(serialized).toContain('Does this screenshot match the RCA?')
    expect(serialized).toContain(
      'RCA is complete. Login refresh regression is in place.',
    )
    expect(serialized).toContain('Completed step 11: inspected login refresh')

    const checkpoint = result.messages[1]
    expect(checkpoint?.role).toBe('user')
    expect(messageText(checkpoint)).toBe(
      `${compactBudgets.CHECKPOINT_PREFIX}\n${summary}`,
    )
    expect(result.summary).toBe(summary)
    expect(estimatePromptTokens(system, result.messages)).toBeLessThanOrEqual(
      highWater,
    )
  })

  it('applies transformSummary to the returned summary and rewritten messages', async () => {
    generateCheckpoint.mockResolvedValue({
      summary: 'Short recap',
      usage: { inputTokens: 2, outputTokens: 1 },
      providerMetadata: undefined,
      responseId: 'r1',
      modelRef,
    })
    const messages: ModelMessage[] = [
      { role: 'user', content: 'Find the auth bug.' },
      { role: 'assistant', content: hugeContent },
    ]

    const result = await runCompactRewrite({
      checkpointInput: checkpointInput(messages),
      system,
      messages,
      highWater,
      transformSummary: (summary) => `${summary}\n\nSubagent ledger:\n- explorer (sub-1): completed`,
    })

    expect(result.summary).toContain('Subagent ledger:')
    expect(result.summary).toContain('Short recap')
    expect(JSON.stringify(result.messages)).toContain('Subagent ledger:')
    expect(JSON.stringify(result.messages)).toContain('Short recap')
  })

  it('rethrows aborted checkpoint generation', async () => {
    const controller = new AbortController()
    generateCheckpoint.mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })
    const messages: ModelMessage[] = [
      { role: 'assistant', content: hugeContent },
    ]

    await expect(
      runCompactRewrite({
        checkpointInput: checkpointInput(messages, controller.signal),
        system,
        messages,
        highWater,
      }),
    ).rejects.toThrow('aborted')
  })
})
