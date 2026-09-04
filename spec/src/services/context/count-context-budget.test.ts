import { describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/context/estimate-builtin-tool-definition-tokens', () => ({
  default: () => 100,
}))

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('tokenlens', () => ({
  getContext: () => ({ maxInput: 100_000, maxTotal: 100_000 }),
}))

vi.mock('@/services/context/system-prompt-parts', async () => {
  const actual = await vi.importActual<
    typeof import('@/services/context/system-prompt-parts')
  >('@/services/context/system-prompt-parts')
  return {
    ...actual,
    default: async () => ({
      base: 'base-system',
      tools: 'Tools are provided as function calls; do not grep the repo for them.',
      mcp: 'mcp-catalog',
      agentsMd: '',
      rules: 'rules-body',
      subagents: 'subagents',
      mentions: '',
      skills: 'skills',
    }),
  }
})

import countContextBudget from '@/services/context/count-context-budget'
import { mcpListStatuses, readMcpConfig } from '@/services/vixl/vixl-tauri'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { SystemPromptParts } from '@/services/context/system-prompt-parts'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const message = (id: string, createdAt: string, text: string): UIMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text }],
  metadata: { createdAt },
})

describe('countContextBudget', () => {
  it('applies activeContext cutoff to the conversation bucket', async () => {
    const longOld = 'x'.repeat(4000)
    const shortNew = 'y'.repeat(40)
    const withoutCutoff = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [
        message('1', '2026-01-01T00:00:00.000Z', longOld),
        message('2', '2026-01-03T00:00:00.000Z', shortNew),
      ],
    })
    const withCutoff = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [
        message('1', '2026-01-01T00:00:00.000Z', longOld),
        message('2', '2026-01-03T00:00:00.000Z', shortNew),
      ],
      activeContext: {
        summary: 'checkpoint',
        includeFromCreatedAt: '2026-01-03T00:00:00.000Z',
      },
    })

    const messagesWithout = withoutCutoff.buckets.find((b) => b.id === 'messages')?.tokens ?? 0
    const messagesWith = withCutoff.buckets.find((b) => b.id === 'messages')?.tokens ?? 0
    expect(messagesWith).toBeLessThan(messagesWithout)
    expect(withCutoff.buckets.some((b) => b.id === 'mcp')).toBe(true)
    expect(withCutoff.buckets.find((b) => b.id === 'tools')?.tokens).toBe(100)
  })

  it('uses catalogOptions context window and reserved output when provider is set', async () => {
    const budget = await countContextBudget({
      modelId: 'gpt-4o',
      providerId: 'openai',
      settings: {
        version: 1,
        'models.catalogOptions': {
          'openai::gpt-4o': { contextWindow: 80_000, maxOutputTokens: 4_000 },
        },
        'models.catalogMeta': {
          'openai::gpt-4o': { contextWindow: 200_000, maxOutputTokens: 16_384 },
        },
      } as VixlSettings,
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [message('1', '2026-01-01T00:00:00.000Z', 'hi')],
    })
    expect(budget.limit).toBe(80_000)
    expect(budget.reservedOutput).toBe(4_000)
  })

  it('does not reserve advertised max output against a smaller selected window', async () => {
    const budget = await countContextBudget({
      modelId: 'zai/glm-5.3-flash',
      providerId: 'gateway',
      settings: {
        version: 1,
        'models.catalogOptions': {
          'gateway::zai/glm-5.3-flash': { contextWindow: 256_000 },
        },
        'models.catalogMeta': {
          'gateway::zai/glm-5.3-flash': {
            contextWindow: 1_048_576,
            maxOutputTokens: 131_072,
          },
        },
      } as VixlSettings,
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [message('1', '2026-01-01T00:00:00.000Z', 'hi')],
    })
    expect(budget.limit).toBe(256_000)
    expect(budget.reservedOutput).toBe(8_192)
    expect(budget.limit - budget.reservedOutput - budget.safetyBuffer).toBe(
      256_000 - 8_192 - 2_000,
    )
  })

  it('counts tool results from timeline in the conversation bucket', async () => {
    const toolPayload = 'z'.repeat(8000)
    const timeline: ChatTimelineItem[] = [
      {
        type: 'user',
        message: message('1', '2026-01-01T00:00:00.000Z', 'hi'),
      },
      {
        type: 'agent-turn',
        turn: {
          id: 'a1',
          text: 'ok',
          steps: [
            {
              id: 's1',
              text: '',
              reasoning: '',
              tools: [
                {
                  toolCallId: 't1',
                  name: 'read_file',
                  status: 'done',
                  args: { path: '/big' },
                  result: { content: toolPayload },
                },
              ],
            },
          ],
        },
      },
    ]

    const withoutTimeline = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [
        message('1', '2026-01-01T00:00:00.000Z', 'hi'),
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'ok' }],
        },
      ],
    })
    const withTimeline = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [
        message('1', '2026-01-01T00:00:00.000Z', 'hi'),
        {
          id: 'a1',
          role: 'assistant',
          parts: [{ type: 'text', text: 'ok' }],
        },
      ],
      timeline,
    })

    const messagesWithout =
      withoutTimeline.buckets.find((b) => b.id === 'messages')?.tokens ?? 0
    const messagesWith =
      withTimeline.buckets.find((b) => b.id === 'messages')?.tokens ?? 0
    expect(messagesWith).toBeGreaterThan(messagesWithout)
    expect(messagesWith).toBeGreaterThan(1000)
  })

  it('still computes a budget when mcpListStatuses rejects', async () => {
    vi.mocked(readMcpConfig).mockResolvedValue({
      servers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
        },
      },
    })
    vi.mocked(mcpListStatuses).mockRejectedValue(new Error('mcp statuses unavailable'))

    try {
      const budget = await countContextBudget({
        modelId: 'gpt-4.1',
        mode: 'agent',
        projectName: 'demo',
        projectRoot: '/tmp/demo',
        mentions: [],
        messages: [message('1', '2026-01-01T00:00:00.000Z', 'hi')],
      })

      const mcpTokens = budget.buckets.find((b) => b.id === 'mcp')?.tokens
      expect(typeof mcpTokens).toBe('number')
      expect(mcpTokens).toBeGreaterThanOrEqual(0)
      expect(budget.promptUsed).toBeGreaterThan(0)
    } finally {
      vi.mocked(readMcpConfig).mockResolvedValue({ servers: {} })
      vi.mocked(mcpListStatuses).mockResolvedValue({})
    }
  })

  it('folds agentsMd tokens into the rules bucket', async () => {
    const baseParts: SystemPromptParts = {
      base: 'base-system',
      tools: 'tools',
      mcp: '',
      agentsMd: '',
      rules: 'rules-body',
      subagents: '',
      mentions: '',
      skills: '',
    }
    const withoutAgentsMd = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [message('1', '2026-01-01T00:00:00.000Z', 'hi')],
      parts: baseParts,
    })
    const withAgentsMd = await countContextBudget({
      modelId: 'gpt-4.1',
      mode: 'agent',
      projectName: 'demo',
      projectRoot: '/tmp/demo',
      mentions: [],
      messages: [message('1', '2026-01-01T00:00:00.000Z', 'hi')],
      parts: { ...baseParts, agentsMd: 'x'.repeat(400) },
    })

    const rulesWithout =
      withoutAgentsMd.buckets.find((bucket) => bucket.id === 'rules')?.tokens ?? 0
    const rulesWith =
      withAgentsMd.buckets.find((bucket) => bucket.id === 'rules')?.tokens ?? 0
    expect(rulesWith).toBeGreaterThan(rulesWithout)
  })
})
