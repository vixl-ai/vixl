import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  createSubagentToolExecutionHooks,
  historyAfterGenerate,
} from '@/services/harness/subagent/generate-support'
import {
  register,
  resetSubagentRegistryForTests,
  setMessages,
} from '@/services/harness/subagent/registry'
import type { HarnessEvent } from '@/types/harness/harness-event'

const user: ModelMessage = { role: 'user', content: 'task' }
const step1: ModelMessage[] = [
  { role: 'assistant', content: 'call grep' },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-grep',
        toolName: 'grep',
        output: { type: 'text', value: 'matches' },
      },
    ],
  },
]
const step2: ModelMessage[] = [
  { role: 'assistant', content: 'call read' },
  {
    role: 'tool',
    content: [
      {
        type: 'tool-result',
        toolCallId: 'call-read',
        toolName: 'read_file',
        output: { type: 'text', value: 'file body' },
      },
    ],
  },
]
const step3: ModelMessage[] = [{ role: 'assistant', content: 'summary' }]

const sdkShapedResult = {
  responseMessages: [...step1, ...step2, ...step3],
  response: { messages: step3 },
  steps: [
    { response: { messages: step1 } },
    { response: { messages: step2 } },
    { response: { messages: step3 } },
  ],
}

describe('historyAfterGenerate', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('appends only the last step onto a multi-step prepareStep snapshot', () => {
    setMessages('sub-1', [user, ...step1, ...step2])

    expect(historyAfterGenerate('sub-1', [user], sdkShapedResult)).toEqual([
      user,
      ...step1,
      ...step2,
      ...step3,
    ])
  })

  it('keeps a mid-run steer that is already in the snapshot', () => {
    const steer: ModelMessage = { role: 'user', content: 'also check tests' }
    setMessages('sub-1', [user, ...step1, steer, ...step2])

    expect(historyAfterGenerate('sub-1', [user], sdkShapedResult)).toEqual([
      user,
      ...step1,
      steer,
      ...step2,
      ...step3,
    ])
  })

  it('rebuilds from a compacted snapshot plus the last step', () => {
    const compacted: ModelMessage[] = [{ role: 'user', content: 'compacted' }]
    setMessages('sub-1', compacted)

    expect(historyAfterGenerate('sub-1', [user], sdkShapedResult)).toEqual([
      ...compacted,
      ...step3,
    ])
  })
})

describe('createSubagentToolExecutionHooks', () => {
  it('emits a non-empty string error when a tool throws an Error', () => {
    const events: HarnessEvent[] = []
    const { onToolExecutionEnd } = createSubagentToolExecutionHooks({
      emitNestedEvent: (event) => {
        events.push(event)
      },
    })

    onToolExecutionEnd({
      toolCall: {
        toolCallId: 't-err',
        toolName: 'write_file',
        input: { path: 'src/failed.ts', content: 'x' },
      },
      toolOutput: { type: 'tool-error', error: new Error('disk full') },
    })

    expect(events).toEqual([
      {
        type: 'tool-result',
        toolCallId: 't-err',
        result: { error: 'disk full' },
        isError: true,
      },
    ])
    const result = events[0] && events[0].type === 'tool-result'
      ? events[0].result
      : undefined
    expect(result).toEqual({ error: 'disk full' })
    expect(typeof (result as { error: unknown }).error).toBe('string')
    expect((result as { error: string }).error.length).toBeGreaterThan(0)
    expect(JSON.stringify(result)).toContain('disk full')
  })

  it('enriches tool error messages the same way as the parent stream', () => {
    const events: HarnessEvent[] = []
    const { onToolExecutionEnd } = createSubagentToolExecutionHooks({
      emitNestedEvent: (event) => {
        events.push(event)
      },
    })

    onToolExecutionEnd({
      toolCall: {
        toolCallId: 't-timeout',
        toolName: 'run_terminal',
        input: { command: 'sleep 999' },
      },
      toolOutput: {
        type: 'tool-error',
        error: new Error('command timed out after 30s'),
      },
    })

    const result = events[0] && events[0].type === 'tool-result'
      ? events[0].result
      : undefined
    expect(result).toEqual({
      error:
        'command timed out after 30s\n\nHint: The shell command exceeded the timeout. For dev servers and watchers, use is_background: true on run_terminal and poll with terminal_output.',
    })
  })

  it('keeps success artifacts on a non-error result', () => {
    const events: HarnessEvent[] = []
    const { onToolExecutionEnd } = createSubagentToolExecutionHooks({
      emitNestedEvent: (event) => {
        events.push(event)
      },
    })

    onToolExecutionEnd({
      toolCall: {
        toolCallId: 't-write',
        toolName: 'write_file',
        input: { path: 'src/a.ts', content: 'x' },
      },
      toolOutput: {
        type: 'tool-result',
        output: { ok: true, path: 'src/a.ts' },
      },
    })

    expect(events).toEqual([
      {
        type: 'tool-result',
        toolCallId: 't-write',
        result: { ok: true, path: 'src/a.ts' },
        isError: false,
        artifact: { kind: 'file', path: 'src/a.ts' },
      },
    ])
  })
})
