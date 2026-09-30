import { describe, expect, it } from 'vitest'
import buildContinueNudge from '@/services/harness/orchestrator/build-continue-nudge'

describe('buildContinueNudge', () => {
  it('tells the model to continue from the provider error without repeating completed tools', () => {
    expect(buildContinueNudge()).toBe(
      'A provider error cut off the previous response. Continue from where it stopped; completed tool calls stand, and tool calls marked interrupted can rerun if still needed.',
    )
  })
})
