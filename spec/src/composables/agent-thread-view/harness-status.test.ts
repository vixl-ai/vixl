import { describe, expect, it } from 'vitest'
import resolveHarnessStatus from '@/composables/agent-thread-view/harness-status'

describe('resolveHarnessStatus', () => {
  it('does not treat a nested running subagent as parent streaming', () => {
    expect(
      resolveHarnessStatus({
        isSubagentView: false,
        subagentRunning: true,
        parentStatus: 'ready',
      }),
    ).toBe('ready')
  })

  it('keeps parent streaming when the parent harness is in flight', () => {
    expect(
      resolveHarnessStatus({
        isSubagentView: false,
        subagentRunning: true,
        parentStatus: 'streaming',
      }),
    ).toBe('streaming')
  })

  it('maps a running subagent view to streaming', () => {
    expect(
      resolveHarnessStatus({
        isSubagentView: true,
        subagentRunning: true,
        parentStatus: 'ready',
      }),
    ).toBe('streaming')
  })
})
