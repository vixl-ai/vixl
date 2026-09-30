import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { StagedImage } from '@/types/harness/staged-image'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const generateText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<{
    text: string
    usage?: unknown
    finishReason?: string
    response?: { id?: string; messages?: unknown[] }
    responseMessages?: unknown[]
  }>>(),
)
const createModel = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)
const captureBillableUsage = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<void>>(),
)
const resolveAgentDefinition = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
      terminal_output: { execute: stubExecute },
      stop_terminal: { execute: stubExecute },
      git_commit: { execute: stubExecute },
    }),
  ),
)
const compactStep = vi.hoisted(() =>
  vi.fn<(options: { messages: unknown[] }) => Promise<{ messages?: unknown[] } | undefined>>(
    async () => undefined,
  ),
)
const prepareCompactStep = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => typeof compactStep>(() => compactStep),
)
const resolveModelVision = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<boolean>>(async () => false),
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

vi.mock('@/services/harness/subagent/prepare-compact-step', () => ({
  default: (...args: unknown[]) => prepareCompactStep(...args),
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: (...args: unknown[]) => resolveModelVision(...args),
}))

import runSubagentGenerate from '@/services/harness/subagent/run-generate'
import { DEFAULT_MAX_OUTPUT_TOKENS } from '@/services/models/resolve-model-call-options'
import { pushSteer } from '@/services/harness/subagent/inbox'
import {
  getSubagent,
  register,
  resetSubagentRegistryForTests,
} from '@/services/harness/subagent/registry'
import repairToolCall from '@/services/harness/orchestrator/repair-tool-call'

type ToolExecutionEndEvent = {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
  toolOutput:
    | { type: 'tool-result'; output: unknown }
    | { type: 'tool-error'; error: unknown }
}

type GenerateConfig = {
  tools?: Record<string, { execute?: (...args: never[]) => Promise<unknown> }>
  prepareStep?: unknown
  system?: string
  repairToolCall?: unknown
  messages?: unknown[]
  prompt?: string
  maxOutputTokens?: number
  onToolExecutionEnd?: (event: ToolExecutionEndEvent) => void
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
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({
      text: 'summary',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    })
    compactStep.mockResolvedValue(undefined)
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

  it('requests the 32768 main-agent default max output', async () => {
    await runSubagentGenerate({
      ctx: {
        ...baseCtx(),
        settings: {
          version: 1,
          'models.catalogMeta': {
            'local::qwen': { contextWindow: 128_000 },
          },
        } as VixlSettings,
      },
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

    const config = generateText.mock.calls[0]?.[0] as GenerateConfig
    expect(config.maxOutputTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS)
    expect(DEFAULT_MAX_OUTPUT_TOKENS).toBe(32_768)
  })
})

describe('runSubagentGenerate capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
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
    expect(toolNames).toContain('run_terminal')
    expect(toolNames).toContain('terminal_output')
    expect(toolNames).toContain('stop_terminal')
    expect(toolNames).not.toContain('edit_file')
    expect(toolNames).not.toContain('apply_patch')
    expect(toolNames).not.toContain('git_commit')
    expect(config.system).toContain('read-only subagent')
    expect(config.system).toContain('run_terminal runs in a sandbox')
    expect(config.system).not.toContain('read-only tools only')
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

  it('puts read-only on nestedCtx when capabilities is read-only', async () => {
    await runWithCapabilities('read-only')
    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    expect(nestedCtx.subagentCapabilities).toBe('read-only')
  })

  it('puts write on nestedCtx when capabilities is write', async () => {
    await runWithCapabilities('write')
    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    expect(nestedCtx.subagentCapabilities).toBe('write')
  })

  it('defaults nestedCtx subagentCapabilities to read-only when omitted', async () => {
    await runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
    } as Parameters<typeof runSubagentGenerate>[0])
    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    expect(nestedCtx.subagentCapabilities).toBe('read-only')
  })
})

describe('runSubagentGenerate pending approval tagging', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
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

  it('does not inherit parent stageImage on nested tool context', async () => {
    const stageImage = vi.fn<(image: StagedImage) => Promise<void>>()
    const ctx = { ...baseCtx(), stageImage }
    await runSubagentGenerate({
      ctx,
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'describe the screenshot',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

    const nestedCtx = buildHarnessTools.mock.calls[0]?.[0] as HarnessToolContext
    expect(nestedCtx.stageImage).toBeUndefined()
    expect(stageImage).not.toHaveBeenCalled()
  })
})

describe('runSubagentGenerate agent definition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({ text: 'summary', usage: {} })
  })

  it('puts Agent definition and body into nested system when resolved', async () => {
    resolveAgentDefinition.mockResolvedValue({
      id: 'reviewer',
      name: 'reviewer',
      description: 'Reviews diffs',
      body: 'Review the diff carefully and report risks.',
      path: '/tmp/project/.vixl/agents/reviewer.md',
      scope: 'project',
    })

    await runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'reviewer',
      prompt: 'review the PR',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

    expect(resolveAgentDefinition).toHaveBeenCalledWith('/tmp/project', 'reviewer')
    const config = generateText.mock.calls[0]?.[0] as GenerateConfig
    expect(config.system).toContain('Agent definition:')
    expect(config.system).toContain('Review the diff carefully and report risks.')
  })
})

describe('runSubagentGenerate steer prepareStep', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    generateText.mockResolvedValue({
      text: 'summary',
      usage: {},
      responseMessages: [{ role: 'assistant', content: 'summary' }],
    })
    compactStep.mockResolvedValue(undefined)
  })

  const runAndPrepare = async () => {
    const events: unknown[] = []
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      model: 'local::qwen',
    })
    await runSubagentGenerate({
      ctx: {
        ...baseCtx(),
        onHarnessEvent: (event) => {
          events.push(event)
        },
      },
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })
    const config = generateText.mock.calls[0]?.[0] as GenerateConfig
    const prepareStep = config.prepareStep as (options: {
      messages: { role: string; content: string }[]
    }) => Promise<{ messages?: unknown[] } | undefined>
    return { prepareStep, events }
  }

  it('appends drained steers then runs compaction on the combined messages', async () => {
    const { prepareStep, events } = await runAndPrepare()
    pushSteer('sub-1', 'first steer')
    pushSteer('sub-1', 'second steer')
    const original = [{ role: 'user' as const, content: 'original task' }]

    const result = await prepareStep({ messages: original })

    expect(compactStep).toHaveBeenCalledWith({
      messages: [
        { role: 'user', content: 'original task' },
        { role: 'user', content: 'first steer' },
        { role: 'user', content: 'second steer' },
      ],
    })
    expect(result).toEqual({
      messages: [
        { role: 'user', content: 'original task' },
        { role: 'user', content: 'first steer' },
        { role: 'user', content: 'second steer' },
      ],
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent-event',
          event: { type: 'subagent-steer', message: 'first steer' },
        }),
        expect.objectContaining({
          type: 'subagent-event',
          event: { type: 'subagent-steer', message: 'second steer' },
        }),
      ]),
    )
  })

  it('still invokes compaction when a steer would exceed the window', async () => {
    compactStep.mockResolvedValue({
      messages: [{ role: 'user', content: 'compacted' }],
    })
    const { prepareStep } = await runAndPrepare()
    pushSteer('sub-1', 'huge follow-up')

    await expect(
      prepareStep({
        messages: [{ role: 'user', content: 'original task' }],
      }),
    ).resolves.toEqual({
      messages: [{ role: 'user', content: 'compacted' }],
    })
    expect(compactStep).toHaveBeenCalledTimes(1)
  })

  it('stores the initial prompt plus response messages when the run completes', async () => {
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
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

    const stored = getSubagent('sub-1')?.messages
    expect(stored?.[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('find the auth bug'),
      }),
    )
    expect(stored?.at(-1)).toEqual({
      role: 'assistant',
      content: 'summary',
    })
  })

  it('writes each compacted snapshot into the registry before persist', async () => {
    const firstCompacted = [{ role: 'user' as const, content: 'compacted-1' }]
    const secondCompacted = [{ role: 'user' as const, content: 'compacted-2' }]
    const midRunSnapshots: unknown[][] = []

    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
    compactStep
      .mockResolvedValueOnce({ messages: firstCompacted })
      .mockResolvedValueOnce({ messages: secondCompacted })
    generateText.mockImplementation(async (config) => {
      const prepareStep = (config as GenerateConfig).prepareStep as (options: {
        messages: { role: string; content: string }[]
      }) => Promise<{ messages?: unknown[] } | undefined>
      await prepareStep({
        messages: [{ role: 'user', content: 'long-1' }],
      })
      midRunSnapshots.push([...(getSubagent('sub-1')?.messages ?? [])])
      await prepareStep({
        messages: [{ role: 'user', content: 'long-2' }],
      })
      midRunSnapshots.push([...(getSubagent('sub-1')?.messages ?? [])])
      return {
        text: 'summary',
        usage: {},
        response: { messages: [{ role: 'assistant', content: 'summary' }] },
      }
    })

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

    expect(midRunSnapshots).toEqual([firstCompacted, secondCompacted])
    expect(getSubagent('sub-1')?.messages).toEqual([
      ...secondCompacted,
      { role: 'assistant', content: 'summary' },
    ])
  })
})

describe('runSubagentGenerate summary validation', () => {
  const run = (capabilities: 'read-only' | 'write' = 'write') =>
    runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities,
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    compactStep.mockResolvedValue(undefined)
    generateText.mockResolvedValue({
      text: 'summary',
      usage: {},
      finishReason: 'stop',
    })
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('passes the parent repairToolCall into the main generateText call', async () => {
    await run()
    const config = generateText.mock.calls[0]?.[0] as GenerateConfig
    expect(config.repairToolCall).toBe(repairToolCall)
  })
})

describe('runSubagentGenerate output-limit truncation', () => {
  const run = () =>
    runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    compactStep.mockResolvedValue(undefined)
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('returns partial text plus a truncation notice when generateText reaches the output limit', async () => {
    generateText.mockResolvedValue({
      text: 'partial summary',
      usage: {},
      finishReason: 'length',
      response: { messages: [{ role: 'assistant', content: 'partial summary' }] },
    })

    const notice = `[The model reached its output limit (${DEFAULT_MAX_OUTPUT_TOKENS} tokens) before finishing. Raise max output in model options or ask for a shorter response.]`
    await expect(run()).resolves.toBe(`partial summary\n\n${notice}`)
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
  })

  it('returns only the truncation notice when generateText reaches the limit with no text', async () => {
    generateText.mockResolvedValue({
      text: '',
      usage: {},
      finishReason: 'length',
      response: { messages: [] },
    })

    await expect(run()).resolves.toBe(
      `[The model reached its output limit (${DEFAULT_MAX_OUTPUT_TOKENS} tokens) before finishing. Raise max output in model options or ask for a shorter response.]`,
    )
  })

  it('returns text when generateText finishes with stop', async () => {
    generateText.mockResolvedValue({
      text: 'summary',
      usage: {},
      finishReason: 'stop',
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    })

    await expect(run()).resolves.toBe('summary')
  })
})

describe('runSubagentGenerate per-step snapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    compactStep.mockResolvedValue(undefined)
    generateText.mockResolvedValue({
      text: 'summary',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    })
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('writes options.messages into the registry without emitting history every step', async () => {
    const events: unknown[] = []
    const snapshot = [
      { role: 'user' as const, content: 'task' },
      { role: 'assistant' as const, content: 'mid-run' },
    ]
    let historyDuringStep = 0
    generateText.mockImplementation(async (config) => {
      const prepareStep = (config as GenerateConfig).prepareStep as (options: {
        messages: { role: string; content: string }[]
      }) => Promise<{ messages?: unknown[] } | undefined>
      await prepareStep({ messages: snapshot })
      historyDuringStep = events.filter((event) => {
        if (!event || typeof event !== 'object' || !('type' in event)) {
          return false
        }
        const nested = (event as { type?: unknown; event?: { type?: unknown } }).event
        return (
          (event as { type?: unknown }).type === 'subagent-event' &&
          nested?.type === 'subagent-history'
        )
      }).length
      expect(getSubagent('sub-1')?.messages).toEqual(snapshot)
      return {
        text: 'summary',
        usage: {},
        response: { messages: [{ role: 'assistant', content: 'summary' }] },
      }
    })

    await runSubagentGenerate({
      ctx: {
        ...baseCtx(),
        onHarnessEvent: (event) => {
          events.push(event)
        },
      },
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

    expect(historyDuringStep).toBe(0)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'subagent-event',
          event: expect.objectContaining({ type: 'subagent-history' }),
        }),
      ]),
    )
  })
})

describe('runSubagentGenerate transient retry', () => {
  const run = () =>
    runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'write',
    })

  const transientError = () =>
    new Error('Failed after 3 attempts GatewayResponseError error sending request')

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    compactStep.mockResolvedValue(undefined)
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('retries from the prepareStep snapshot after a transient error', async () => {
    const snapshot = [
      { role: 'user' as const, content: 'task' },
      { role: 'assistant' as const, content: 'wrote src/a.ts' },
    ]
    generateText.mockImplementationOnce(async (config) => {
      const prepareStep = (config as GenerateConfig).prepareStep as (options: {
        messages: { role: string; content: string }[]
      }) => Promise<{ messages?: unknown[] } | undefined>
      await prepareStep({ messages: snapshot })
      throw transientError()
    })
    generateText.mockResolvedValueOnce({
      text: 'recovered',
      usage: { inputTokens: 4 },
      response: { messages: [{ role: 'assistant', content: 'recovered' }] },
    })

    const pending = run()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toBe('recovered')

    expect(generateText).toHaveBeenCalledTimes(2)
    const second = generateText.mock.calls[1]?.[0] as GenerateConfig
    expect(second.messages).toEqual(snapshot)
    expect(second.prompt).toBeUndefined()
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
  })

  it('fails immediately on a non-transient error', async () => {
    generateText.mockRejectedValueOnce(new Error('Invalid tool arguments'))
    await expect(run()).rejects.toThrow('Invalid tool arguments')
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).not.toHaveBeenCalled()
  })

  it('does not retry abort errors', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    generateText.mockRejectedValueOnce(abortError)
    await expect(run()).rejects.toThrow('The operation was aborted.')
    expect(generateText).toHaveBeenCalledTimes(1)
  })

  it('aborts during backoff without a second generateText call', async () => {
    const controller = new AbortController()
    generateText.mockRejectedValueOnce(transientError())

    const pending = runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: controller.signal,
      model: 'local::qwen',
      capabilities: 'write',
    })
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(pending).rejects.toThrow('Subagent aborted')
    expect(generateText).toHaveBeenCalledTimes(1)
  })
})

type PrepareStepFn = (options: {
  messages: { role: string; content: string }[]
}) => Promise<{ messages?: { role: string; content: string }[] } | undefined>

const step1Messages = [
  { role: 'assistant' as const, content: 'call grep' },
  { role: 'tool' as const, content: 'matches' },
]
const step2Messages = [
  { role: 'assistant' as const, content: 'call read' },
  { role: 'tool' as const, content: 'file body' },
]
const step3Messages = [{ role: 'assistant' as const, content: 'summary' }]

const inputFromConfig = (
  config: GenerateConfig,
): { role: string; content: string }[] => {
  if (Array.isArray(config.messages) && config.messages.length > 0) {
    return config.messages as { role: string; content: string }[]
  }
  return [{ role: 'user', content: String(config.prompt) }]
}

const applyPrepareStep = async (
  prepareStep: PrepareStepFn,
  messages: { role: string; content: string }[],
): Promise<{ role: string; content: string }[]> => {
  const prepared = await prepareStep({ messages })
  return prepared?.messages ?? messages
}

const threeStepSdkResult = async (
  config: GenerateConfig,
  betweenSteps?: { afterStep1?: () => void },
) => {
  const prepareStep = config.prepareStep as PrepareStepFn
  let messages = await applyPrepareStep(prepareStep, inputFromConfig(config))
  messages = [...messages, ...step1Messages]
  betweenSteps?.afterStep1?.()
  messages = await applyPrepareStep(prepareStep, messages)
  messages = [...messages, ...step2Messages]
  await applyPrepareStep(prepareStep, messages)
  return {
    text: 'summary',
    usage: {},
    responseMessages: [...step1Messages, ...step2Messages, ...step3Messages],
    response: { messages: step3Messages },
    steps: [
      { response: { messages: step1Messages } },
      { response: { messages: step2Messages } },
      { response: { messages: step3Messages } },
    ],
  }
}

const countByContent = (messages: unknown[] | undefined, content: string): number =>
  (messages ?? []).filter((message) => {
    if (message === null || typeof message !== 'object') {
      return false
    }
    return 'content' in message && message.content === content
  }).length

describe('runSubagentGenerate multi-step history', () => {
  const run = () =>
    runSubagentGenerate({
      ctx: baseCtx(),
      subagentId: 'sub-1',
      agentName: 'explore',
      prompt: 'find the auth bug',
      toolCallId: 'call-1',
      signal: new AbortController().signal,
      model: 'local::qwen',
      capabilities: 'read-only',
    })

  beforeEach(() => {
    vi.clearAllMocks()
    resetSubagentRegistryForTests()
    createModel.mockResolvedValue({ id: 'stub-model' })
    captureBillableUsage.mockResolvedValue(undefined)
    resolveAgentDefinition.mockResolvedValue(null)
    compactStep.mockResolvedValue(undefined)
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('persists a 3-step run without duplicating assistant or tool messages', async () => {
    generateText.mockImplementation(async (config) =>
      threeStepSdkResult(config as GenerateConfig),
    )

    await run()

    const stored = getSubagent('sub-1')?.messages
    expect(stored?.[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('find the auth bug'),
      }),
    )
    expect(countByContent(stored, 'call grep')).toBe(1)
    expect(countByContent(stored, 'matches')).toBe(1)
    expect(countByContent(stored, 'call read')).toBe(1)
    expect(countByContent(stored, 'file body')).toBe(1)
    expect(countByContent(stored, 'summary')).toBe(1)
    expect(stored?.slice(-5)).toEqual([
      ...step1Messages,
      ...step2Messages,
      ...step3Messages,
    ])
  })

  it('does not duplicate steps after one transient retry', async () => {
    vi.useFakeTimers()
    generateText.mockImplementationOnce(async (config) => {
      const prepareStep = (config as GenerateConfig).prepareStep as PrepareStepFn
      await prepareStep({ messages: inputFromConfig(config as GenerateConfig) })
      throw new Error(
        'Failed after 3 attempts GatewayResponseError error sending request',
      )
    })
    generateText.mockImplementationOnce(async (config) =>
      threeStepSdkResult(config as GenerateConfig),
    )

    const pending = run()
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      await pending
    } finally {
      vi.useRealTimers()
    }

    const stored = getSubagent('sub-1')?.messages
    expect(generateText).toHaveBeenCalledTimes(2)
    const second = generateText.mock.calls[1]?.[0] as GenerateConfig
    expect(second.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('find the auth bug'),
        }),
      ]),
    )
    expect(countByContent(stored, 'call grep')).toBe(1)
    expect(countByContent(stored, 'matches')).toBe(1)
    expect(countByContent(stored, 'call read')).toBe(1)
    expect(countByContent(stored, 'file body')).toBe(1)
    expect(countByContent(stored, 'summary')).toBe(1)
  })

  it('keeps a mid-run steer once and does not duplicate prior steps', async () => {
    generateText.mockImplementation(async (config) =>
      threeStepSdkResult(config as GenerateConfig, {
        afterStep1: () => {
          pushSteer('sub-1', 'also check tests')
        },
      }),
    )

    await run()

    const stored = getSubagent('sub-1')?.messages
    expect(countByContent(stored, 'also check tests')).toBe(1)
    expect(countByContent(stored, 'call grep')).toBe(1)
    expect(countByContent(stored, 'matches')).toBe(1)
    expect(countByContent(stored, 'call read')).toBe(1)
    expect(countByContent(stored, 'file body')).toBe(1)
    expect(countByContent(stored, 'summary')).toBe(1)
    const steerIndex = stored?.findIndex(
      (message) =>
        typeof message === 'object' &&
        message &&
        'content' in message &&
        message.content === 'also check tests',
    )
    const grepIndex = stored?.findIndex(
      (message) =>
        typeof message === 'object' &&
        message &&
        'content' in message &&
        message.content === 'call grep',
    )
    expect(steerIndex).toBeGreaterThan(grepIndex ?? -1)
  })
})

