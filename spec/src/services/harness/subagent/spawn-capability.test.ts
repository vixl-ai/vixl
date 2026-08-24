import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'

const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<null>>(),
)
const getPlanExecutionSession = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { subagentModel: string | null }>(),
)
const assertNotAwaitingPlanGo = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => void>(),
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
  assertNotAwaitingPlanGo: (...args: unknown[]) =>
    assertNotAwaitingPlanGo(...args),
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

const writeError = (mode: VixlChatMode): string =>
  `Write-capable subagents are not allowed in ${mode} mode. Spawn with capabilities: "read-only" (the default).`

const baseCtx = (mode: VixlChatMode): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode,
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  onHarnessEvent: () => {},
})

const execute = async (
  mode: VixlChatMode,
  capabilities?: 'read-only' | 'write',
): Promise<unknown> => {
  const built = spawnSubagent(baseCtx(mode))
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  const input: Record<string, unknown> = {
    agentName: 'Reading auth',
    prompt: 'Summarize the auth flow.',
    mode: 'blocking',
  }
  if (capabilities !== undefined) {
    input.capabilities = capabilities
  }
  return runner(input, { toolCallId: 'call-1' })
}

describe('spawn_subagent capability enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resolveAgentDefinition.mockResolvedValue(null)
    getPlanExecutionSession.mockReturnValue({ subagentModel: null })
    resolveSpawnModel.mockResolvedValue('anthropic::claude-sonnet-4')
    runSubagentGenerate.mockResolvedValue('ok summary')
  })

  const readOnlyModes: VixlChatMode[] = ['ask', 'plan', 'studio']
  const writeAllowedModes: VixlChatMode[] = ['agent', 'orchestrator']

  it('rejects write capabilities in ask, plan, and studio', async () => {
    for (const mode of readOnlyModes) {
      runSubagentGenerate.mockClear()
      await expect(execute(mode, 'write')).rejects.toThrow(writeError(mode))
      expect(runSubagentGenerate).not.toHaveBeenCalled()
    }
  })

  it('allows read-only capabilities in ask, plan, and studio', async () => {
    for (const mode of readOnlyModes) {
      runSubagentGenerate.mockClear()
      await expect(execute(mode, 'read-only')).resolves.toMatchObject({
        name: 'Reading auth',
        summary: 'ok summary',
      })
      expect(runSubagentGenerate).toHaveBeenCalledTimes(1)
    }
  })

  it('allows omitted capabilities in ask, plan, and studio', async () => {
    for (const mode of readOnlyModes) {
      runSubagentGenerate.mockClear()
      await expect(execute(mode)).resolves.toMatchObject({
        summary: 'ok summary',
      })
      expect(runSubagentGenerate).toHaveBeenCalledTimes(1)
    }
  })

  it('allows write capabilities in agent and orchestrator', async () => {
    for (const mode of writeAllowedModes) {
      runSubagentGenerate.mockClear()
      await expect(execute(mode, 'write')).resolves.toMatchObject({
        name: 'Reading auth',
        summary: 'ok summary',
      })
      expect(runSubagentGenerate).toHaveBeenCalledTimes(1)
    }
  })
})
