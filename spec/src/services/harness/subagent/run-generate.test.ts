import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PyrolaSettings } from '@/types/pyrola/pyrola-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const generateText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{ text: string; usage?: unknown }>>(),
)
const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)
const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<null>>(),
)
const grepExecute = vi.hoisted(() =>
  vi.fn<
    () => Promise<{ matches: string[]; truncated: boolean }>
  >(async () => ({
    matches: ['x'.repeat(100000)],
    truncated: false,
  })),
)
const buildHarnessTools = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { grep: { execute: typeof grepExecute } }>(
    () => ({
      grep: {
        execute: grepExecute,
      },
    }),
  ),
)

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) => generateText(...args),
  isLoopFinished: () => () => false,
}))

vi.mock('@/services/providers/create-model', () => ({
  default: (...args: unknown[]) => createModel(...args),
}))

vi.mock('@/services/billing/capture-billable-usage', () => ({
  default: (...args: unknown[]) => captureBillableUsage(...args),
}))

vi.mock('@/services/agents/resolve-agent-definition', () => ({
  default: (...args: unknown[]) => resolveAgentDefinition(...args),
}))

vi.mock('@/services/harness/build-harness-tools', () => ({
  default: (...args: unknown[]) => buildHarnessTools(...args),
}))

import runSubagentGenerate from '@/services/harness/subagent/run-generate'

type GenerateConfig = {
  tools?: Record<string, { execute?: (...args: never[]) => Promise<unknown> }>
  prepareStep?: unknown
}

const TOKEN_CAP = 8000

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  turnId: 'turn-1',
  settings: { version: 1 } as PyrolaSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
})

describe('runSubagentGenerate compaction wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({ text: 'summary', usage: {} })
  })

  it('wraps nested tools and passes prepareStep to generateText', async () => {
    await runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
    })

    expect(generateText).toHaveBeenCalledTimes(1)
    const config = generateText.mock.calls[0]?.[0] as GenerateConfig
    expect(config.prepareStep).toBeTypeOf('function')

    const grep = config.tools?.grep
    expect(grep?.execute).toBeTypeOf('function')
    expect(grep?.execute).not.toBe(grepExecute)

    const result = await grep!.execute!()
    expect(result).toMatchObject({ truncated: true })
    expect(estimateTextTokens(JSON.stringify(result))).toBeLessThanOrEqual(TOKEN_CAP)
    expect(grepExecute).toHaveBeenCalled()
  })
})
