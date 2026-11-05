import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const runSubagentGenerate = vi.hoisted(() =>
  vi.fn<
    (...args: unknown[]) => Promise<{ text: string; finishReason?: string }>
  >(),
)

vi.mock('@/services/harness/subagent/run-generate', () => ({
  default: (...args: unknown[]) => runSubagentGenerate(...args),
}))

import {
  noPoll,
  noPollTerminal,
  steerAccepted,
  visibleStatus,
} from '@/services/harness/guidance'
import runTerminal from '@/services/harness/shell/run-terminal'
import resumeSubagent from '@/services/harness/subagent/resume'
import steerSubagent from '@/services/harness/subagent/steer'
import {
  register,
  resetSubagentRegistryForTests,
  resolve,
} from '@/services/harness/subagent/registry'

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  onHarnessEvent: () => {},
})

describe('harness guidance clauses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    runSubagentGenerate.mockResolvedValue({
      text: 'second summary',
      finishReason: 'stop',
    })
  })

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

  it('requires a one-line visible status for spawned and finished work', () => {
    expect(visibleStatus('spawned')).toContain(
      'what was spawned, what is still running, what happens next',
    )
    expect(visibleStatus('finished')).toContain(
      'what finished, what is still running, what happens next',
    )
  })

  it('puts the terminal-only no-poll clause on the run_terminal description', () => {
    expect(noPollTerminal).toContain('is_background returns a shell id')
    expect(noPollTerminal).toContain('end the turn and wait')
    expect(noPollTerminal).toContain('when that background terminal exits')
    expect(runTerminal(baseCtx()).description).toContain(noPollTerminal)
  })

  it('puts the steer-accepted clause on the steer_subagent description and resume note', async () => {
    expect(steerAccepted).toContain('acceptance only')
    expect(steerAccepted).toContain('end the turn without reporting it')
    expect(steerAccepted).toContain('The harness wake brings the result')
    expect(steerSubagent(baseCtx()).description).toContain(steerAccepted)

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
      prompt: 'first task',
      model: 'local::qwen',
      capabilities: 'read-only',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: 'first summary',
    })

    await expect(resumeSubagent(baseCtx(), 'sub-1', 'keep going')).resolves.toMatchObject({
      note: expect.stringContaining(steerAccepted),
    })
  })
})
