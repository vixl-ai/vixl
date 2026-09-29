import { describe, expect, it } from 'vitest'
import { noPoll, visibleStatus } from '@/services/harness/guidance'

describe('harness guidance clauses', () => {
  it('forbids polling and says the harness resumes as each background subagent finishes', () => {
    expect(noPoll).toContain('Do not poll subagent progress with any tool')
    expect(noPoll).toContain('terminal_output is only for your own shell_id')
    expect(noPoll).toContain('End the turn')
    expect(noPoll).toContain('as each background subagent finishes')
  })

  it('requires a one-line visible status for spawned, steered, and finished work', () => {
    expect(visibleStatus('spawned')).toContain(
      'what was spawned, what is still running, and what happens next',
    )
    expect(visibleStatus('steered')).toContain(
      'what was steered, what is still running, and what happens next',
    )
    expect(visibleStatus('finished')).toContain(
      'what finished, what is still running, and what happens next',
    )
  })
})
