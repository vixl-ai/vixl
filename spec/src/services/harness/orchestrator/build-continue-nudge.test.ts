import { describe, expect, it } from 'vitest'
import buildContinueNudge from '@/services/harness/orchestrator/build-continue-nudge'

describe('buildContinueNudge', () => {
  it('tells the model to continue from the provider error without repeating completed tools', () => {
    expect(buildContinueNudge()).toBe(
      'The previous response was cut off by a provider error. Continue the task from where it stopped. Do not repeat tool calls that already completed. Re-run any tool call marked interrupted if still needed.',
    )
  })
})
