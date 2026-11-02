import { beforeEach, describe, expect, it } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import trimResultSummary from '@/services/harness/orchestrator/trim-result-summary'
import getSubagent from '@/services/harness/subagent/get-subagent'
import {
  fail,
  register,
  resetSubagentRegistryForTests,
  resolve,
  restoreSubagent,
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

const execute = (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = getSubagent(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'get-subagent-1' })
}

describe('get_subagent', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('returns identity fields and omits summary unless summary is true', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
      model: 'local::qwen',
      capabilities: 'write',
    })
    resolve('sub-1', {
      subagentId: 'sub-1',
      name: 'explorer',
      summary: '  first pass  ',
    })

    const withoutSummary = (await execute({ subagentId: 'sub-1' })) as Record<
      string,
      unknown
    >
    expect(withoutSummary).toEqual({
      subagentId: 'sub-1',
      agentName: 'explorer',
      status: 'completed',
      startedAt: expect.any(String),
      model: 'local::qwen',
      capabilities: 'write',
    })
    expect(withoutSummary).not.toHaveProperty('summary')

    const withSummary = await execute({ subagentId: 'sub-1', summary: true })
    expect(withSummary).toEqual({
      ...withoutSummary,
      summary: trimResultSummary('  first pass  '),
    })
  })

  it('returns null model and capabilities when missing, and null summary when the run has none', async () => {
    restoreSubagent({
      subagentId: 'sub-1',
      chatId: 'chat-1',
      toolCallId: 'tc-1',
      agentName: 'explorer',
      status: 'interrupted',
      startedAt: '2020-01-01T00:00:00.000Z',
    })

    await expect(execute({ subagentId: 'sub-1', summary: true })).resolves.toEqual({
      subagentId: 'sub-1',
      agentName: 'explorer',
      status: 'interrupted',
      startedAt: '2020-01-01T00:00:00.000Z',
      model: null,
      capabilities: null,
      summary: null,
    })
  })

  it('returns a trimmed summary when summary is true', async () => {
    const longSummary = `  ${'a'.repeat(520)}  `
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'tc-1',
      agentName: 'explorer',
    })
    fail('sub-1', longSummary)

    await expect(execute({ subagentId: 'sub-1', summary: true })).resolves.toMatchObject({
      subagentId: 'sub-1',
      status: 'failed',
      summary: trimResultSummary(longSummary),
    })
  })

  it('throws for an id outside the chat', async () => {
    restoreSubagent({
      subagentId: 'sub-other',
      chatId: 'chat-2',
      toolCallId: 'tc-2',
      agentName: 'other',
      status: 'completed',
      startedAt: '2020-01-01T00:00:00.000Z',
    })

    await expect(execute({ subagentId: 'sub-other' })).rejects.toThrow(
      'Unknown subagentId: sub-other',
    )
    await expect(execute({ subagentId: 'missing' })).rejects.toThrow(
      'Unknown subagentId: missing',
    )
  })
})
