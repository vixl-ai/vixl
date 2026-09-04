import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessStreamInput } from '@/types/harness/harness-stream-input'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import type { SystemPromptParts } from '@/services/context/system-prompt-parts'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const readChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
)
const updateChatMeta = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined),
)
const assembleSystemPromptParts = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<SystemPromptParts>>(),
)
const countContextBudget = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    readChatMeta: (...args: unknown[]) => readChatMeta(...args),
    updateChatMeta: (...args: unknown[]) => updateChatMeta(...args),
  }),
)

vi.mock('@/services/providers/create-model', () => ({
  default: vi.fn<() => Promise<{ id: string }>>(async () => ({ id: 'stub-model' })),
}))

vi.mock('@/services/context/system-prompt-parts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/context/system-prompt-parts')>()
  return {
    ...actual,
    default: (...args: unknown[]) => assembleSystemPromptParts(...args),
  }
})

vi.mock('@/services/context/count-context-budget', () => ({
  default: (...args: unknown[]) => countContextBudget(...args),
}))

const buildTools = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => { read_file: { description: string } }>(() => ({
    read_file: { description: 'r' },
  })),
)

vi.mock('@/services/harness/build-tools', () => ({
  default: (...args: unknown[]) => buildTools(...args),
}))

vi.mock('@/services/harness/resolve-model-vision', () => ({
  default: vi.fn<() => Promise<boolean>>(async () => false),
}))

vi.mock('@/services/models/resolve-model-call-options', () => ({
  DEFAULT_MAX_OUTPUT_TOKENS: 8192,
  resolveModelCallOptions: () => ({}),
}))

vi.mock('@/services/models/resolve-reasoning-for-call', () => ({
  pickResolvedReasoning: () => undefined,
  resolveCatalogReasoning: () => undefined,
  resolveReasoningForRole: () => undefined,
}))

vi.mock('@/services/models/resolve-model-ref-for-call', () => ({
  default: () => ({
    createRef: { providerId: 'openai', modelId: 'gpt' },
    optionRef: { providerId: 'openai', modelId: 'gpt' },
  }),
}))

vi.mock('@/services/harness/orchestrator/stream-steps', () => ({
  default: () => ({ stepCount: 0 }),
}))

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn<() => void>(), success: vi.fn<() => void>() },
}))

import prepareStream from '@/services/harness/orchestrator/prepare-stream'
import { joinSystemPromptParts } from '@/services/context/system-prompt-parts'
import { buildPrefixSnapshot } from '@/services/harness/prefix-contract'

const promptParts = (mode: string): SystemPromptParts => ({
  base: `You are Vixl, an AI coding agent in ${mode} mode.`,
  tools: 'tools',
  mcp: '',
  agentsMd: '',
  rules: '',
  subagents: '',
  mentions: '',
  skills: '',
})

const frozen = (mode: PrefixSnapshot['mode'], systemMode = mode): PrefixSnapshot => ({
  systemString: `You are Vixl, an AI coding agent in ${systemMode} mode.`,
  toolSchemasJson: 'tools',
  mcpCatalogSnapshot: '',
  rulesBodies: '',
  hash: 'deadbeef',
  frozenAt: '2026-01-01T00:00:00.000Z',
  mode,
  parts: promptParts(systemMode ?? 'agent'),
})

const snapshotFromParts = (
  mode: PrefixSnapshot['mode'],
  parts: SystemPromptParts,
): PrefixSnapshot => {
  const prefixParts = { ...parts, mentions: '' }
  return buildPrefixSnapshot({
    systemString: joinSystemPromptParts(prefixParts),
    toolSchemasJson: parts.tools,
    mcpCatalogSnapshot: parts.mcp,
    rulesBodies: [parts.agentsMd, parts.rules].filter(Boolean).join('\n\n'),
    mode,
    parts: prefixParts,
  })
}

type SessionSets = {
  sessionAllows?: Set<string>
  sessionDenies?: Set<string>
}

const buildInput = (
  mode: HarnessStreamInput['mode'],
  sets?: SessionSets,
): HarnessStreamInput =>
  ({
    projectSlug: 'proj',
    chatId: 'chat-1',
    projectRoot: '/tmp/proj',
    projectName: 'proj',
    mode,
    modelId: 'gpt',
    providerId: 'openai',
    settings: { version: 1 },
    mentions: [],
    messages: [],
    modelMessages: [],
    userMessageId: 'user-1',
    signal: new AbortController().signal,
    onEvent: vi.fn<(...args: unknown[]) => void>(),
    assistantId: 'asst-1',
    captureTurnMessages: false,
    sessionAllows: sets?.sessionAllows ?? new Set<string>(),
    sessionDenies: sets?.sessionDenies ?? new Set<string>(),
  }) as HarnessStreamInput

type BuildToolsCtx = {
  sessionAllows: Set<string>
  sessionDenies: Set<string>
}

describe('prepare-stream prefix freeze vs rebuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assembleSystemPromptParts.mockImplementation(async (...args: unknown[]) =>
      promptParts(String((args[0] as { mode: string }).mode)),
    )
    countContextBudget.mockResolvedValue({
      modelId: 'gpt',
      used: 1,
      promptUsed: 1,
      limit: 100,
      reservedOutput: 1,
      safetyBuffer: 1,
      free: 1,
      buckets: [],
    })
    updateChatMeta.mockResolvedValue(undefined)
  })

  it('reuses frozen prefix when mode is unchanged', async () => {
    const frozenSnapshot = snapshotFromParts('agent', promptParts('agent'))
    readChatMeta.mockResolvedValue({
      prefixSnapshot: frozenSnapshot,
    })
    const onEvent = vi.fn<(...args: unknown[]) => void>()

    const prepared = await prepareStream({ ...buildInput('agent'), onEvent })

    expect(assembleSystemPromptParts).toHaveBeenCalledWith(
      expect.objectContaining({ mentions: [] }),
    )
    expect(prepared.system).toBe(frozenSnapshot.systemString)
    expect(updateChatMeta).not.toHaveBeenCalled()
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chat-meta-changed' }),
    )
  })

  it('rebuilds frozen prefix when content hash differs', async () => {
    const frozenSnapshot = snapshotFromParts('agent', promptParts('agent'))
    readChatMeta.mockResolvedValue({
      prefixSnapshot: frozenSnapshot,
    })
    assembleSystemPromptParts.mockImplementation(async () => ({
      ...promptParts('agent'),
      agentsMd: 'AGENTS.md guidance:\n\nFollow project conventions.',
    }))
    const onEvent = vi.fn<(...args: unknown[]) => void>()

    const prepared = await prepareStream({ ...buildInput('agent'), onEvent })

    expect(assembleSystemPromptParts).toHaveBeenCalled()
    expect(prepared.system).toContain('Follow project conventions.')
    expect(prepared.system).not.toBe(frozenSnapshot.systemString)
    expect(updateChatMeta).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        prefixSnapshot: expect.objectContaining({ mode: 'agent' }),
      }),
    )
    const stored = updateChatMeta.mock.calls[0]?.[2] as {
      prefixSnapshot: PrefixSnapshot
    }
    expect(stored.prefixSnapshot.hash).not.toBe(frozenSnapshot.hash)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat-meta-changed',
        patch: expect.objectContaining({
          prefixSnapshot: expect.objectContaining({ mode: 'agent' }),
        }),
      }),
    )
  })

  it('rebuilds frozen prefix when rules change', async () => {
    const frozenSnapshot = snapshotFromParts('agent', promptParts('agent'))
    readChatMeta.mockResolvedValue({
      prefixSnapshot: frozenSnapshot,
    })
    assembleSystemPromptParts.mockImplementation(async () => ({
      ...promptParts('agent'),
      rules: 'Always use kebab-case filenames.',
    }))
    const onEvent = vi.fn<(...args: unknown[]) => void>()

    const prepared = await prepareStream({ ...buildInput('agent'), onEvent })

    expect(prepared.system).toContain('Always use kebab-case filenames.')
    expect(prepared.system).not.toBe(frozenSnapshot.systemString)
    expect(updateChatMeta).toHaveBeenCalled()
    const stored = updateChatMeta.mock.calls[0]?.[2] as {
      prefixSnapshot: PrefixSnapshot
    }
    expect(stored.prefixSnapshot.hash).not.toBe(frozenSnapshot.hash)
    expect(stored.prefixSnapshot.systemString).not.toBe(frozenSnapshot.systemString)
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat-meta-changed',
        patch: expect.objectContaining({
          prefixSnapshot: expect.objectContaining({ mode: 'agent' }),
        }),
      }),
    )
  })

  it('rebuilds frozen prefix when mode changes', async () => {
    readChatMeta.mockResolvedValue({
      prefixSnapshot: frozen('agent'),
    })
    const onEvent = vi.fn<(...args: unknown[]) => void>()
    const input = { ...buildInput('ask'), onEvent }

    const prepared = await prepareStream(input)

    expect(assembleSystemPromptParts).toHaveBeenCalled()
    expect(prepared.system).toContain('in ask mode')
    expect(updateChatMeta).toHaveBeenCalledWith(
      'proj',
      'chat-1',
      expect.objectContaining({
        prefixSnapshot: expect.objectContaining({ mode: 'ask' }),
      }),
    )
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'chat-meta-changed',
        patch: expect.objectContaining({
          prefixSnapshot: expect.objectContaining({ mode: 'ask' }),
        }),
      }),
    )
  })

  it('rebuilds legacy snapshots when inferred mode differs', async () => {
    readChatMeta.mockResolvedValue({
      prefixSnapshot: frozen(undefined, 'agent'),
    })

    const prepared = await prepareStream(buildInput('plan'))

    expect(assembleSystemPromptParts).toHaveBeenCalled()
    expect(prepared.system).toContain('in plan mode')
  })
})

describe('prepare-stream session permission sets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    assembleSystemPromptParts.mockImplementation(async (...args: unknown[]) =>
      promptParts(String((args[0] as { mode: string }).mode)),
    )
    countContextBudget.mockResolvedValue({
      modelId: 'gpt',
      used: 1,
      promptUsed: 1,
      limit: 100,
      reservedOutput: 1,
      safetyBuffer: 1,
      free: 1,
      buckets: [],
    })
    updateChatMeta.mockResolvedValue(undefined)
    readChatMeta.mockResolvedValue(null)
  })

  it('passes the provided session sets into buildTools with the same identity', async () => {
    const sessionAllows = new Set<string>(['fs.write'])
    const sessionDenies = new Set<string>(['fs.delete'])

    await prepareStream(buildInput('agent', { sessionAllows, sessionDenies }))

    expect(buildTools).toHaveBeenCalledTimes(1)
    const ctx = buildTools.mock.calls[0]?.[0] as BuildToolsCtx
    expect(ctx.sessionAllows).toBe(sessionAllows)
    expect(ctx.sessionDenies).toBe(sessionDenies)
    expect(ctx.sessionAllows.has('fs.write')).toBe(true)
  })

  it('keeps session allow mutations across a second prepare-stream', async () => {
    const sessionAllows = new Set<string>()
    const sessionDenies = new Set<string>()

    await prepareStream(buildInput('agent', { sessionAllows, sessionDenies }))
    const first = buildTools.mock.calls[0]?.[0] as BuildToolsCtx
    first.sessionAllows.add('fs.write')

    await prepareStream(buildInput('agent', { sessionAllows, sessionDenies }))
    const second = buildTools.mock.calls[1]?.[0] as BuildToolsCtx

    expect(second.sessionAllows).toBe(sessionAllows)
    expect(second.sessionDenies).toBe(sessionDenies)
    expect(second.sessionAllows.has('fs.write')).toBe(true)
  })
})
