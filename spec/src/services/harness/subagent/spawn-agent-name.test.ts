import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const getPlanExecutionSession = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { subagentModel: string | null }>(),
)
const registerSubagent = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const resolveSubagent = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const emitSubagentResult = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const finishSubagentWithError = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => void>(),
)
const resolveSpawnModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(),
)
const runSubagentGenerate = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<string>>(),
)
const linkAbortSignal = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())

vi.mock('@/services/agents/resolve-agent-definition', () => ({
  default: (...args: unknown[]) => resolveAgentDefinition(...args),
}))

vi.mock('@/services/harness/plan-execution-session', () => ({
  getPlanExecutionSession: (...args: unknown[]) =>
    getPlanExecutionSession(...args),
}))

vi.mock('@/services/harness/subagent/registry', () => ({
  register: (...args: unknown[]) => registerSubagent(...args),
  resolve: (...args: unknown[]) => resolveSubagent(...args),
}))

vi.mock('@/services/harness/subagent/helpers', () => ({
  emitSubagentResult: (...args: unknown[]) => emitSubagentResult(...args),
  finishSubagentWithError: (...args: unknown[]) =>
    finishSubagentWithError(...args),
}))

vi.mock('@/services/harness/subagent/resolve-spawn-model', () => ({
  default: (...args: unknown[]) => resolveSpawnModel(...args),
}))

vi.mock('@/services/harness/subagent/run-generate', () => ({
  default: (...args: unknown[]) => runSubagentGenerate(...args),
}))

vi.mock('@/utils/link-abort-signal', () => ({
  default: (...args: unknown[]) => linkAbortSignal(...args),
}))

import spawnSubagent from '@/services/harness/subagent/spawn'
import { noPoll, visibleStatus } from '@/services/harness/guidance'

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

const execute = (agentName: string): Promise<unknown> => {
  const built = spawnSubagent(baseCtx())
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(
    {
      agentName,
      prompt: 'Find auth helpers.',
      mode: 'blocking',
    },
    { toolCallId: 'call-1' },
  )
}

const spawnedName = (): unknown =>
  (registerSubagent.mock.calls[0]?.[3] as { agentName?: string } | undefined)
    ?.agentName

describe('spawn_subagent agentName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAgentDefinition.mockResolvedValue(null)
    getPlanExecutionSession.mockReturnValue({ subagentModel: null })
    resolveSpawnModel.mockResolvedValue('anthropic::claude-sonnet-4')
    runSubagentGenerate.mockResolvedValue('ok summary')
  })

  it.each(['explore', 'shell', 'run-ci', 'review_bugbot', 'Fix 3 Angi review findings'])(
    'spawns non-catalog name %s as a generic helper with the name unchanged',
    async (agentName) => {
      await expect(execute(agentName)).resolves.toMatchObject({
        name: agentName,
        summary: 'ok summary',
      })
      expect(spawnedName()).toBe(agentName)
      expect(runSubagentGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ agentName }),
      )
    },
  )

  it('spawns when the catalog lookup fails', async () => {
    resolveAgentDefinition.mockRejectedValue(new Error('catalog unreadable'))
    await expect(execute('Reading auth')).resolves.toMatchObject({
      name: 'Reading auth',
    })
    expect(resolveSpawnModel).toHaveBeenCalledWith(
      expect.objectContaining({ frontmatterModel: undefined }),
    )
  })

  it('uses the catalog definition model for a catalog agentName', async () => {
    resolveAgentDefinition.mockResolvedValue({
      id: 'explorer',
      name: 'explorer',
      description: 'Explore the repo',
      body: '',
      model: 'local::qwen',
      path: '/tmp/project/.vixl/agents/explorer.md',
      scope: 'project',
    })
    const events: Array<{ type: string; name?: string }> = []
    const ctx = baseCtx()
    ctx.onHarnessEvent = (event) => {
      events.push(event as { type: string; name?: string })
    }
    const built = spawnSubagent(ctx)
    const runner = built.execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    await runner(
      {
        agentName: 'explorer',
        prompt: 'Find auth helpers.',
        mode: 'blocking',
      },
      { toolCallId: 'call-1' },
    )
    expect(resolveAgentDefinition).toHaveBeenCalledWith('/tmp/project', 'explorer')
    expect(resolveSpawnModel).toHaveBeenCalledWith(
      expect.objectContaining({ frontmatterModel: 'local::qwen' }),
    )
    expect(events.find((event) => event.type === 'subagent-start')).toMatchObject({
      name: 'explorer',
    })
    expect(spawnedName()).toBe('explorer')
  })

  it('describes background spawn, visible status, and no-poll on the tool', () => {
    const built = spawnSubagent(baseCtx())
    expect(built.description).toContain(visibleStatus('spawned'))
    expect(built.description).toContain(noPoll)
    expect(built.description).toContain('Background returns immediately')
  })

  it('guides agentName naming without describing rejections', () => {
    const built = spawnSubagent(baseCtx())
    const schema = built.inputSchema as unknown as {
      shape: { agentName: { description?: string } }
    }
    expect(schema.shape.agentName.description).toContain('Catalog name')
    expect(schema.shape.agentName.description).toContain('verb phrase')
    expect(schema.shape.agentName.description).not.toMatch(/reject/i)
  })
})
