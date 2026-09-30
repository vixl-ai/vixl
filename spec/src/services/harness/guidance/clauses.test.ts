import { describe, expect, it } from 'vitest'
import { noPoll, visibleStatus } from '@/services/harness/guidance'

describe('harness guidance clauses', () => {
  it('ends the turn instead of polling and says the harness resumes as each background subagent finishes', () => {
    expect(noPoll).toContain('End the turn and wait')
    expect(noPoll).toContain('as each background subagent finishes')
    expect(noPoll).toContain('progress checks through tools')
    expect(noPoll).toContain('terminal_output reads only run_terminal shell_id values')
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
