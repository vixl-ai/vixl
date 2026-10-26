import { describe, expect, it } from 'vitest'
import { noPoll, visibleStatus } from '@/services/harness/guidance'

describe('harness guidance clauses', () => {
  it('ends the turn instead of polling and says the harness resumes for subagents and terminals', () => {
    expect(noPoll).toContain('End the turn and wait')
    expect(noPoll).toContain('when a background subagent finishes')
    expect(noPoll).toContain('when a background terminal exits')
    expect(noPoll).toContain('progress checks through tools')
    expect(noPoll).toContain(
      'terminal_output reads output for a run_terminal shell id before that shell exits',
    )
    expect(noPoll).toContain('it is not how you wait for completion')
  })

  it('requires a one-line visible status for spawned, steered, and finished work', () => {
    expect(visibleStatus('spawned')).toContain(
      'what was spawned, what is still running, what happens next',
    )
    expect(visibleStatus('steered')).toContain(
      'what was steered, what is still running, what happens next',
    )
    expect(visibleStatus('finished')).toContain(
      'what finished, what is still running, what happens next',
    )
  })
})
