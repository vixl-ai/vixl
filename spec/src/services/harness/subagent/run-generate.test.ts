import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { StagedImage } from '@/types/harness/staged-image'
import estimateTextTokens from '@/utils/estimate-text-tokens'

type StreamGenerateResult = {
  text: string
  usage?: unknown
  finishReason?: string
  providerMetadata?: unknown
  response?: { id?: string; messages?: unknown[] }
  responseMessages?: unknown[]
  steps?: unknown[]
}

type StreamPart = {
  type: string
  text?: string
  error?: unknown
}

type StreamTextResult = {
  fullStream: AsyncIterable<StreamPart>
  text: string | PromiseLike<string>
  finishReason?: string | PromiseLike<string | undefined>
  usage?: unknown | PromiseLike<unknown>
  providerMetadata?: unknown | PromiseLike<unknown>
  response?:
    | { id?: string; messages?: unknown[] }
    | PromiseLike<{ id?: string; messages?: unknown[] } | undefined>
  responseMessages?: unknown[] | PromiseLike<unknown[] | undefined>
  steps?: unknown[] | PromiseLike<unknown[] | undefined>
}

const streamText = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => StreamTextResult>(),
)

const resolvedStream = (value: StreamGenerateResult & { parts?: StreamPart[] }): StreamTextResult => ({
  ...value,
  fullStream: (async function* () {
    for (const part of value.parts ?? []) {
      yield part
    }
  })(),
  text: value.text,
  finishReason: value.finishReason,
  usage: value.usage,
  providerMetadata: value.providerMetadata,
  response: value.response,
  responseMessages: value.responseMessages,
  steps: value.steps,
})
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
  streamText: (...args: unknown[]) => streamText(...args),
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
import { applySubagentItemEvent } from '@/utils/apply-subagent-step-event'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'

type ToolExecutionEndEvent = {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
  toolOutput:
    | { type: 'tool-result'; output: unknown }
    | { type: 'tool-error'; error: unknown }
}

type ToolExecutionStartEvent = {
  toolCall: { toolCallId: string; toolName: string; input: unknown }
}

type GenerateConfig = {
  tools?: Record<string, { execute?: (...args: never[]) => Promise<unknown> }>
  prepareStep?: unknown
  system?: string
  repairToolCall?: unknown
  messages?: unknown[]
  prompt?: string
  maxOutputTokens?: number
  onToolExecutionStart?: (event: ToolExecutionStartEvent) => void
  onToolExecutionEnd?: (event: ToolExecutionEndEvent) => void
}

const streamFromWork = (
  work: (config: GenerateConfig) => Promise<StreamGenerateResult>,
): ((config: unknown) => StreamTextResult) => {
  return (config) => {
    const pending = work(config as GenerateConfig)
    return {
      fullStream: {
        [Symbol.asyncIterator]() {
          let settled = false
          return {
            async next() {
              if (settled) {
                return { done: true as const, value: undefined }
              }
              settled = true
              await pending
              return { done: true as const, value: undefined }
            },
          }
        },
      },
      get text() {
        return pending.then((result) => result.text)
      },
      get finishReason() {
        return pending.then((result) => result.finishReason)
      },
      get usage() {
        return pending.then((result) => result.usage)
      },
      get providerMetadata() {
        return pending.then((result) => result.providerMetadata)
      },
      get response() {
        return pending.then((result) => result.response)
      },
      get responseMessages() {
        return pending.then((result) => result.responseMessages)
      },
      get steps() {
        return pending.then((result) => result.steps)
      },
    }
  }
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
    streamText.mockReturnValue(resolvedStream({
      text: 'summary',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    }))
    compactStep.mockResolvedValue(undefined)
  })

  it('wraps nested tools and passes prepareStep to streamText', async () => {
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

    expect(streamText).toHaveBeenCalledTimes(1)
    const config = streamText.mock.calls[0]?.[0] as GenerateConfig
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

    const config = streamText.mock.calls[0]?.[0] as GenerateConfig
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
    streamText.mockReturnValue(resolvedStream({ text: 'summary', usage: {} }))
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
    return streamText.mock.calls[0]?.[0] as GenerateConfig
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
    streamText.mockReturnValue(resolvedStream({ text: 'summary', usage: {} }))
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
    streamText.mockReturnValue(resolvedStream({ text: 'summary', usage: {} }))
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
    const config = streamText.mock.calls[0]?.[0] as GenerateConfig
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
    streamText.mockReturnValue(resolvedStream({
      text: 'summary',
      usage: {},
      responseMessages: [{ role: 'assistant', content: 'summary' }],
    }))
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
    const config = streamText.mock.calls[0]?.[0] as GenerateConfig
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
    streamText.mockImplementation(streamFromWork(async (config) => {
      const prepareStep = config.prepareStep as (options: {
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
    }))

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
    streamText.mockReturnValue(resolvedStream({
      text: 'summary',
      usage: {},
      finishReason: 'stop',
    }))
    register('chat-1', 'sub-1', new AbortController(), {
      toolCallId: 'call-1',
      agentName: 'explore',
      model: 'local::qwen',
    })
  })

  it('passes the parent repairToolCall into the main streamText call', async () => {
    await run()
    const config = streamText.mock.calls[0]?.[0] as GenerateConfig
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

  it('returns partial text plus a truncation notice when streamText reaches the output limit', async () => {
    streamText.mockReturnValue(resolvedStream({
      text: 'partial summary',
      usage: {},
      finishReason: 'length',
      response: { messages: [{ role: 'assistant', content: 'partial summary' }] },
    }))

    const notice = `[The model reached its output limit (${DEFAULT_MAX_OUTPUT_TOKENS} tokens) before finishing. Raise max output in model options or ask for a shorter response.]`
    await expect(run()).resolves.toEqual({
      text: `partial summary\n\n${notice}`,
      finishReason: 'length',
    })
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
  })

  it('returns only the truncation notice when streamText reaches the limit with no text', async () => {
    streamText.mockReturnValue(resolvedStream({
      text: '',
      usage: {},
      finishReason: 'length',
      response: { messages: [] },
    }))

    await expect(run()).resolves.toEqual({
      text: `[The model reached its output limit (${DEFAULT_MAX_OUTPUT_TOKENS} tokens) before finishing. Raise max output in model options or ask for a shorter response.]`,
      finishReason: 'length',
    })
  })

  it('returns text when streamText finishes with stop', async () => {
    streamText.mockReturnValue(resolvedStream({
      text: 'summary',
      usage: {},
      finishReason: 'stop',
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    }))

    await expect(run()).resolves.toEqual({
      text: 'summary',
      finishReason: 'stop',
    })
  })

  it('returns content-filter finish without a truncation notice', async () => {
    streamText.mockReturnValue(resolvedStream({
      text: 'blocked',
      usage: {},
      finishReason: 'content-filter',
      response: { messages: [{ role: 'assistant', content: 'blocked' }] },
    }))

    await expect(run()).resolves.toEqual({
      text: 'blocked',
      finishReason: 'content-filter',
    })
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
    streamText.mockReturnValue(resolvedStream({
      text: 'summary',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'summary' }] },
    }))
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
    streamText.mockImplementation(streamFromWork(async (config) => {
      const prepareStep = config.prepareStep as (options: {
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
    }))

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
    streamText.mockImplementationOnce(streamFromWork(async (config) => {
      const prepareStep = config.prepareStep as (options: {
        messages: { role: string; content: string }[]
      }) => Promise<{ messages?: unknown[] } | undefined>
      await prepareStep({ messages: snapshot })
      throw transientError()
    }))
    streamText.mockReturnValueOnce(resolvedStream({
      text: 'recovered',
      usage: { inputTokens: 4 },
      response: { messages: [{ role: 'assistant', content: 'recovered' }] },
    }))

    const pending = run()
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(pending).resolves.toEqual({ text: 'recovered' })

    expect(streamText).toHaveBeenCalledTimes(2)
    const second = streamText.mock.calls[1]?.[0] as GenerateConfig
    expect(second.messages).toEqual(snapshot)
    expect(second.prompt).toBeUndefined()
    expect(captureBillableUsage).toHaveBeenCalledTimes(1)
  })

  it('fails immediately on a non-transient error', async () => {
    streamText.mockImplementationOnce(() => {
      throw new Error('Invalid tool arguments')
    })
    await expect(run()).rejects.toThrow('Invalid tool arguments')
    expect(streamText).toHaveBeenCalledTimes(1)
    expect(captureBillableUsage).not.toHaveBeenCalled()
  })

  it('does not retry abort errors', async () => {
    const abortError = new Error('The operation was aborted.')
    abortError.name = 'AbortError'
    streamText.mockImplementationOnce(() => {
      throw abortError
    })
    await expect(run()).rejects.toThrow('The operation was aborted.')
    expect(streamText).toHaveBeenCalledTimes(1)
  })

  it('aborts during backoff without a second streamText call', async () => {
    const controller = new AbortController()
    streamText.mockImplementationOnce(() => {
      throw transientError()
    })

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
    expect(streamText).toHaveBeenCalledTimes(1)
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
    streamText.mockImplementation(
      streamFromWork((config) => threeStepSdkResult(config)),
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
    streamText.mockImplementationOnce(streamFromWork(async (config) => {
      const prepareStep = config.prepareStep as PrepareStepFn
      await prepareStep({ messages: inputFromConfig(config) })
      throw new Error(
        'Failed after 3 attempts GatewayResponseError error sending request',
      )
    }))
    streamText.mockImplementationOnce(
      streamFromWork((config) => threeStepSdkResult(config)),
    )

    const pending = run()
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      await pending
    } finally {
      vi.useRealTimers()
    }

    const stored = getSubagent('sub-1')?.messages
    expect(streamText).toHaveBeenCalledTimes(2)
    const second = streamText.mock.calls[1]?.[0] as GenerateConfig
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
    streamText.mockImplementation(
      streamFromWork((config) =>
        threeStepSdkResult(config, {
          afterStep1: () => {
            pushSteer('sub-1', 'also check tests')
          },
        }),
      ),
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

const nestedFrom = (events: unknown[]): HarnessEvent[] =>
  events.flatMap((event) => {
    if (
      event &&
      typeof event === 'object' &&
      'type' in event &&
      (event as { type?: unknown }).type === 'subagent-event' &&
      'event' in event
    ) {
      return [(event as { event: HarnessEvent }).event]
    }
    return []
  })

describe('runSubagentGenerate nested step stream', () => {
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

  const runWithEvents = async () => {
    const events: unknown[] = []
    const result = await runSubagentGenerate({
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
    return { events: nestedFrom(events), result }
  }

  it('emits reasoning-delta with stepId before tool events', async () => {
    streamText.mockImplementation((config) => {
      const typed = config as GenerateConfig
      return {
        fullStream: (async function* () {
          yield { type: 'start-step' }
          yield { type: 'reasoning-delta', text: 'looking at auth' }
          typed.onToolExecutionStart?.({
            toolCall: {
              toolCallId: 'tc-grep',
              toolName: 'grep',
              input: { query: 'auth' },
            },
          })
          typed.onToolExecutionEnd?.({
            toolCall: {
              toolCallId: 'tc-grep',
              toolName: 'grep',
              input: { query: 'auth' },
            },
            toolOutput: { type: 'tool-result', output: { matches: ['login.ts'] } },
          })
          yield { type: 'text-delta', text: 'found it' }
          yield { type: 'finish-step' }
        })(),
        text: 'found it',
        finishReason: 'stop',
        usage: {},
        response: { messages: [{ role: 'assistant', content: 'found it' }] },
      }
    })

    const { events, result } = await runWithEvents()
    const types = events.map((event) => event.type)
    const reasoningIndex = types.indexOf('reasoning-delta')
    const toolIndex = types.indexOf('tool-start')
    const reasoning = events.find((event) => event.type === 'reasoning-delta')
    const stepStart = events.find((event) => event.type === 'step-start')

    expect(reasoningIndex).toBeGreaterThanOrEqual(0)
    expect(toolIndex).toBeGreaterThan(reasoningIndex)
    expect(reasoning).toEqual({
      type: 'reasoning-delta',
      delta: 'looking at auth',
      stepId: expect.any(String),
    })
    expect(stepStart && reasoning && 'stepId' in reasoning).toBe(true)
    const reasoningMatchesStep =
      stepStart?.type === 'step-start' &&
      reasoning?.type === 'reasoning-delta' &&
      reasoning.stepId === stepStart.stepId
    expect(reasoningMatchesStep).toBe(true)
    expect(result).toEqual({ text: 'found it', finishReason: 'stop' })
  })

  it('emits exactly one step-content snapshot per step with full replaced fields', async () => {
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'reasoning-delta', text: 'think-' }
        yield { type: 'reasoning-delta', text: '1' }
        yield { type: 'text-delta', text: 'hello' }
        yield { type: 'text-delta', text: ' world' }
        yield { type: 'finish-step' }
        yield { type: 'start-step' }
        yield { type: 'text-delta', text: 'second' }
        yield { type: 'finish-step' }
      })(),
      text: 'second',
      finishReason: 'stop',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'second' }] },
    })

    const { events } = await runWithEvents()
    const contents = events.filter((event) => event.type === 'step-content')
    const starts = events.filter((event) => event.type === 'step-start')
    expect(contents).toHaveLength(2)
    expect(starts).toHaveLength(2)
    expect(contents[0]).toEqual({
      type: 'step-content',
      stepId: starts[0] && starts[0].type === 'step-start' ? starts[0].stepId : '',
      reasoning: 'think-1',
      reasoningSeconds: expect.any(Number),
      text: 'hello world',
    })
    expect(contents[1]).toEqual({
      type: 'step-content',
      stepId: starts[1] && starts[1].type === 'step-start' ? starts[1].stepId : '',
      reasoning: '',
      reasoningSeconds: 0,
      text: 'second',
    })
    expect(contents[0]?.type === 'step-content' && contents[1]?.type === 'step-content').toBe(
      true,
    )
    const distinctStepIds =
      contents[0]?.type === 'step-content' &&
      contents[1]?.type === 'step-content' &&
      contents[0].stepId !== contents[1].stepId
    expect(distinctStepIds).toBe(true)
    expect(events.filter((event) => event.type === 'step-drop-unsealed')).toEqual([])
  })

  it('keeps truncation notice on the parent tool result after a streamed length finish', async () => {
    streamText.mockReturnValue(resolvedStream({
      text: 'partial summary',
      usage: {},
      finishReason: 'length',
      response: { messages: [{ role: 'assistant', content: 'partial summary' }] },
      parts: [
        { type: 'start-step' },
        { type: 'text-delta', text: 'partial summary' },
        { type: 'finish-step' },
      ],
    }))

    const { result, events } = await runWithEvents()
    const notice = `[The model reached its output limit (${DEFAULT_MAX_OUTPUT_TOKENS} tokens) before finishing. Raise max output in model options or ask for a shorter response.]`
    expect(result).toEqual({
      text: `partial summary\n\n${notice}`,
      finishReason: 'length',
    })
    expect(events.filter((event) => event.type === 'step-content')).toHaveLength(1)
  })

  it('seals partial step content then stops without billing when aborted', async () => {
    const controller = new AbortController()
    const events: unknown[] = []
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'reasoning-delta', text: 'partial think' }
        yield { type: 'text-delta', text: 'partial text' }
        controller.abort()
        yield { type: 'text-delta', text: 'after abort' }
      })(),
      text: 'partial text',
      finishReason: 'stop',
      usage: {},
      response: { messages: [] },
    })

    await expect(
      runSubagentGenerate({
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
        signal: controller.signal,
        model: 'local::qwen',
        capabilities: 'read-only',
      }),
    ).rejects.toThrow('Subagent aborted')
    expect(captureBillableUsage).not.toHaveBeenCalled()

    const nested = nestedFrom(events)
    const starts = nested.filter((event) => event.type === 'step-start')
    const contents = nested.filter((event) => event.type === 'step-content')
    const finishes = nested.filter((event) => event.type === 'step-finish')
    const stepId = starts[0]?.type === 'step-start' ? starts[0].stepId : ''
    expect(contents).toHaveLength(1)
    expect(contents[0]).toEqual({
      type: 'step-content',
      stepId,
      reasoning: 'partial think',
      reasoningSeconds: expect.any(Number),
      text: 'partial text',
    })
    expect(finishes).toEqual([{ type: 'step-finish', stepId }])
    expect(nested.filter((event) => event.type === 'step-drop-unsealed')).toEqual([])
    expect(
      nested.filter(
        (event) => event.type === 'text-delta' && event.delta === 'after abort',
      ),
    ).toEqual([])
    const contentIndex = nested.findIndex((event) => event.type === 'step-content')
    const finishIndex = nested.findIndex((event) => event.type === 'step-finish')
    expect(contentIndex).toBeGreaterThanOrEqual(0)
    expect(finishIndex).toBeGreaterThan(contentIndex)
  })

  it('drops unsealed orphan steps after a mid-stream transient retry', async () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const transient = new Error(
      'Failed after 3 attempts GatewayResponseError error sending request',
    )
    streamText.mockImplementationOnce((config) => {
      const typed = config as GenerateConfig
      return {
        fullStream: (async function* () {
          yield { type: 'start-step' }
          typed.onToolExecutionStart?.({
            toolCall: {
              toolCallId: 'tc-sealed',
              toolName: 'grep',
              input: { query: 'auth' },
            },
          })
          typed.onToolExecutionEnd?.({
            toolCall: {
              toolCallId: 'tc-sealed',
              toolName: 'grep',
              input: { query: 'auth' },
            },
            toolOutput: { type: 'tool-result', output: { matches: ['login.ts'] } },
          })
          yield { type: 'text-delta', text: 'sealed text' }
          yield { type: 'finish-step' }
          yield { type: 'start-step' }
          typed.onToolExecutionStart?.({
            toolCall: {
              toolCallId: 'tc-orphan',
              toolName: 'read_file',
              input: { path: 'login.ts' },
            },
          })
          yield { type: 'text-delta', text: 'orphan text' }
          yield { type: 'error', error: transient }
        })(),
        text: 'orphan text',
        finishReason: 'error',
        usage: {},
        response: { messages: [] },
      }
    })
    streamText.mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'text-delta', text: 'retry text' }
        yield { type: 'finish-step' }
      })(),
      text: 'retry text',
      finishReason: 'stop',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'retry text' }] },
    }))

    const pending = runSubagentGenerate({
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
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toEqual({
        text: 'retry text',
        finishReason: 'stop',
      })
    } finally {
      vi.useRealTimers()
    }

    const nested = nestedFrom(events)
    const starts = nested.filter((event) => event.type === 'step-start')
    const contents = nested.filter((event) => event.type === 'step-content')
    const drops = nested.filter((event) => event.type === 'step-drop-unsealed')
    const sealedId =
      starts[0]?.type === 'step-start' ? starts[0].stepId : ''
    const orphanId =
      starts[1]?.type === 'step-start' ? starts[1].stepId : ''
    const retryId =
      starts[2]?.type === 'step-start' ? starts[2].stepId : ''

    expect(starts).toHaveLength(3)
    expect(drops).toEqual([{ type: 'step-drop-unsealed', stepIds: [orphanId] }])
    expect(
      contents.some(
        (event) => event.type === 'step-content' && event.stepId === orphanId,
      ),
    ).toBe(false)
    expect(contents.map((event) => event.type === 'step-content' && event.stepId)).toEqual([
      sealedId,
      retryId,
    ])
    const dropIndex = nested.findIndex((event) => event.type === 'step-drop-unsealed')
    const retryStartIndex = nested.findIndex(
      (event, index) => index > dropIndex && event.type === 'step-start',
    )
    expect(dropIndex).toBeGreaterThan(0)
    expect(retryStartIndex).toBeGreaterThan(dropIndex)

    let item: SubagentTimelineItem = {
      type: 'subagent',
      subagentId: 'sub-1',
      name: 'explore',
      blocking: false,
      status: 'running',
      tools: [],
      steps: [],
      compactions: [],
    }
    for (const event of nested) {
      item = applySubagentItemEvent(item, event)
    }
    expect(item.steps?.map((step) => step.id)).toEqual([sealedId, retryId])
    expect(item.tools.map((tool) => tool.toolCallId)).toEqual(['tc-sealed'])
    expect(item.tools[0]?.status).toBe('done')
  })

  it('seals partial step content on terminal non-transient failure', async () => {
    const events: unknown[] = []
    streamText.mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'reasoning-delta', text: 'partial think' }
        yield { type: 'text-delta', text: 'partial text' }
        yield { type: 'error', error: new Error('Invalid tool arguments') }
      })(),
      text: 'partial text',
      finishReason: 'error',
      usage: {},
      response: { messages: [] },
    })

    await expect(
      runSubagentGenerate({
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
      }),
    ).rejects.toThrow('Invalid tool arguments')
    expect(captureBillableUsage).not.toHaveBeenCalled()
    expect(streamText).toHaveBeenCalledTimes(1)

    const nested = nestedFrom(events)
    const starts = nested.filter((event) => event.type === 'step-start')
    const contents = nested.filter((event) => event.type === 'step-content')
    const finishes = nested.filter((event) => event.type === 'step-finish')
    const stepId = starts[0]?.type === 'step-start' ? starts[0].stepId : ''
    expect(contents).toHaveLength(1)
    expect(contents[0]).toEqual({
      type: 'step-content',
      stepId,
      reasoning: 'partial think',
      reasoningSeconds: expect.any(Number),
      text: 'partial text',
    })
    expect(finishes).toEqual([{ type: 'step-finish', stepId }])
    expect(nested.filter((event) => event.type === 'step-drop-unsealed')).toEqual([])
    const contentIndex = nested.findIndex((event) => event.type === 'step-content')
    const finishIndex = nested.findIndex((event) => event.type === 'step-finish')
    expect(contentIndex).toBeGreaterThanOrEqual(0)
    expect(finishIndex).toBeGreaterThan(contentIndex)
  })

  it('seals the last open step once when transient retries are exhausted', async () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const transient = () =>
      new Error(
        'Failed after 3 attempts GatewayResponseError error sending request',
      )
    const failingStream = (label: string) => ({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'reasoning-delta', text: `${label} think` }
        yield { type: 'text-delta', text: `${label} text` }
        yield { type: 'error', error: transient() }
      })(),
      text: `${label} text`,
      finishReason: 'error',
      usage: {},
      response: { messages: [] },
    })
    streamText
      .mockImplementationOnce(() => failingStream('first'))
      .mockImplementationOnce(() => failingStream('second'))
      .mockImplementationOnce(() => failingStream('third'))

    const pending = runSubagentGenerate({
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
    const outcome = pending.then(
      () => {
        throw new Error('expected generate to fail')
      },
      (error: unknown) => error,
    )
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      await vi.advanceTimersByTimeAsync(6_000)
      await expect(outcome).resolves.toEqual(
        expect.objectContaining({
          message:
            'Failed after 3 attempts GatewayResponseError error sending request',
        }),
      )
    } finally {
      vi.useRealTimers()
    }

    expect(streamText).toHaveBeenCalledTimes(3)
    expect(captureBillableUsage).not.toHaveBeenCalled()

    const nested = nestedFrom(events)
    const starts = nested.filter((event) => event.type === 'step-start')
    const contents = nested.filter((event) => event.type === 'step-content')
    const finishes = nested.filter((event) => event.type === 'step-finish')
    const drops = nested.filter((event) => event.type === 'step-drop-unsealed')
    const firstId = starts[0]?.type === 'step-start' ? starts[0].stepId : ''
    const secondId = starts[1]?.type === 'step-start' ? starts[1].stepId : ''
    const lastId = starts[2]?.type === 'step-start' ? starts[2].stepId : ''

    expect(starts).toHaveLength(3)
    expect(contents).toHaveLength(1)
    expect(finishes).toHaveLength(1)
    expect(contents[0]).toEqual({
      type: 'step-content',
      stepId: lastId,
      reasoning: 'third think',
      reasoningSeconds: expect.any(Number),
      text: 'third text',
    })
    expect(finishes).toEqual([{ type: 'step-finish', stepId: lastId }])
    expect(drops).toEqual([
      { type: 'step-drop-unsealed', stepIds: [firstId] },
      { type: 'step-drop-unsealed', stepIds: [secondId] },
    ])
  })

  it('drops the failed attempt and seals only the retry on success', async () => {
    vi.useFakeTimers()
    const events: unknown[] = []
    const transient = new Error(
      'Failed after 3 attempts GatewayResponseError error sending request',
    )
    streamText.mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'reasoning-delta', text: 'orphan think' }
        yield { type: 'text-delta', text: 'orphan text' }
        yield { type: 'error', error: transient }
      })(),
      text: 'orphan text',
      finishReason: 'error',
      usage: {},
      response: { messages: [] },
    }))
    streamText.mockImplementationOnce(() => ({
      fullStream: (async function* () {
        yield { type: 'start-step' }
        yield { type: 'text-delta', text: 'retry text' }
        yield { type: 'finish-step' }
      })(),
      text: 'retry text',
      finishReason: 'stop',
      usage: {},
      response: { messages: [{ role: 'assistant', content: 'retry text' }] },
    }))

    const pending = runSubagentGenerate({
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
    try {
      await vi.advanceTimersByTimeAsync(2_000)
      await expect(pending).resolves.toEqual({
        text: 'retry text',
        finishReason: 'stop',
      })
    } finally {
      vi.useRealTimers()
    }

    const nested = nestedFrom(events)
    const starts = nested.filter((event) => event.type === 'step-start')
    const contents = nested.filter((event) => event.type === 'step-content')
    const finishes = nested.filter((event) => event.type === 'step-finish')
    const drops = nested.filter((event) => event.type === 'step-drop-unsealed')
    const orphanId = starts[0]?.type === 'step-start' ? starts[0].stepId : ''
    const retryId = starts[1]?.type === 'step-start' ? starts[1].stepId : ''

    expect(starts).toHaveLength(2)
    expect(drops).toEqual([{ type: 'step-drop-unsealed', stepIds: [orphanId] }])
    expect(contents).toHaveLength(1)
    expect(finishes).toHaveLength(1)
    expect(contents[0]).toEqual({
      type: 'step-content',
      stepId: retryId,
      reasoning: '',
      reasoningSeconds: 0,
      text: 'retry text',
    })
    expect(finishes).toEqual([{ type: 'step-finish', stepId: retryId }])
    expect(
      contents.some(
        (event) => event.type === 'step-content' && event.stepId === orphanId,
      ),
    ).toBe(false)
    const dropIndex = nested.findIndex((event) => event.type === 'step-drop-unsealed')
    const retryStartIndex = nested.findIndex(
      (event, index) => index > dropIndex && event.type === 'step-start',
    )
    const contentIndex = nested.findIndex((event) => event.type === 'step-content')
    expect(dropIndex).toBeGreaterThan(0)
    expect(retryStartIndex).toBeGreaterThan(dropIndex)
    expect(contentIndex).toBeGreaterThan(retryStartIndex)
  })
})


