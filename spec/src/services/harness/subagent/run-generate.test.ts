import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
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
const stubExecute = vi.hoisted(() => vi.fn<() => Promise<unknown>>())
const buildHarnessTools = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Record<string, { execute: typeof grepExecute | typeof stubExecute }>>(
    () => ({
      read_file: { execute: stubExecute },
      grep: { execute: grepExecute },
      edit_file: { execute: stubExecute },
      apply_patch: { execute: stubExecute },
      run_terminal: { execute: stubExecute },
      git_commit: { execute: stubExecute },
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
  system?: string
}

const TOKEN_CAP = 8000

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  turnId: 'turn-1',
  settings: { version: 1 } as VixlSettings,
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
      capabilities: 'read-only',
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

describe('runSubagentGenerate capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({ text: 'summary', usage: {} })
  })

  const runWithCapabilities = async (
    capabilities: 'read-only' | 'write',
  ): Promise<GenerateConfig> => {
    await runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities,
    })
    return generateText.mock.calls[0]?.[0] as GenerateConfig
  }

  it('keeps only read-only tools and a read-only system prompt', async () => {
    const config = await runWithCapabilities('read-only')
    const toolNames = Object.keys(config.tools ?? {})
    expect(toolNames).toContain('read_file')
    expect(toolNames).toContain('grep')
    expect(toolNames).not.toContain('edit_file')
    expect(toolNames).not.toContain('apply_patch')
    expect(toolNames).not.toContain('run_terminal')
    expect(toolNames).not.toContain('git_commit')
    expect(config.system).toContain('read-only sub-agent')
  })

  it('includes write tools and omits the read-only system prompt', async () => {
    const config = await runWithCapabilities('write')
    const toolNames = Object.keys(config.tools ?? {})
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'read_file',
        'grep',
        'edit_file',
        'apply_patch',
        'run_terminal',
        'git_commit',
      ]),
    )
    expect(config.system).not.toContain('read-only')
  })
})

describe('runSubagentGenerate pending approval tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({ text: 'summary', usage: {} })
  })

  it('attaches subagentId and subagentLabel before forwarding onPendingApproval', async () => {
    const onPendingApproval = vi.fn<HarnessToolContext['onPendingApproval']>()
    await runSubagentGenerate({
      ctx: { ...baseCtx(), onPendingApproval },
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'edit the auth helper',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'write',
    })

    expect(buildHarnessTools).toHaveBeenCalledTimes(1)
    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    nestedCtx.onPendingApproval({
      toolCallId: 'tc-edit',
      name: 'edit_file',
      kind: 'fs',
      title: 'Edit file',
      allowedScopes: ['once'],
    })

    expect(onPendingApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        toolCallId: 'tc-edit',
        name: 'edit_file',
        subagentId: 'sub-1',
        subagentLabel: 'explore',
      }),
    )
  })

  it('reuses the parent sessionAllows and sessionDenies sets', async () => {
    const ctx = baseCtx()
    await runSubagentGenerate({
      ctx,
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'edit the auth helper',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'write',
    })

    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    expect(nestedCtx.sessionAllows).toBe(ctx.sessionAllows)
    expect(nestedCtx.sessionDenies).toBe(ctx.sessionDenies)
  })
})
