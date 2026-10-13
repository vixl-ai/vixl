import { beforeEach, describe, expect, it } from 'vitest'
import {
  register,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'
import { turnSpawnedBackgroundSubagents } from '@/services/harness/subagent/turn-spawned-background'

describe('turnSpawnedBackgroundSubagents', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('is true only when this turn includes a background spawn tool call', () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-bg',
      agentName: 'explorer',
    })
    register(
      'chat-1',
      'sub-block',
      new AbortController(),
      { toolCallId: 'tc-block', agentName: 'blocker' },
      { pendingResume: false },
    )
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'mapped the repo',
    })

    expect(
      turnSpawnedBackgroundSubagents('chat-1', [
        { role: 'assistant', content: 'later user reply' },
      ]),
    ).toBe(false)
    expect(
      turnSpawnedBackgroundSubagents('chat-1', [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-block',
              toolName: 'spawn_subagent',
              output: { type: 'json', value: { pending: false } },
            },
          ],
        },
      ]),
    ).toBe(false)
    expect(
      turnSpawnedBackgroundSubagents('chat-1', [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'tc-bg',
              toolName: 'spawn_subagent',
              output: { type: 'json', value: { pending: true } },
            },
          ],
        },
      ]),
    ).toBe(true)
  })
})
