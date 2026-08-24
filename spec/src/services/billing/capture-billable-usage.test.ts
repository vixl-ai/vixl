import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import type { LanguageModelUsage } from 'ai'
import type { JSONObject } from '@ai-sdk/provider'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { ChatUsageTotals } from '@/types/chat/chat-meta'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

type EnrichGatewayCostResult = {
  record: BillableUsageRecord | null
  records: BillableUsageRecord[]
  usageTotals: ChatUsageTotals | null
}

type EnrichGatewayCostInput = {
  projectSlug: string
  chatId: string
  recordId: string
  generationId: string
  gatewayClient: unknown
  delay?: (ms: number) => Promise<void>
}

type AppendUsageLedgerResult = {
  records: BillableUsageRecord[]
  usageTotals: ChatUsageTotals
}

const enrichGatewayCost = vi.fn<
  (input: EnrichGatewayCostInput) => Promise<EnrichGatewayCostResult>
>(async () => ({
  record: null,
  records: [],
  usageTotals: null,
}))

const appendUsageLedger = vi.fn<
  (
    projectSlug: string,
    chatId: string,
    record: BillableUsageRecord,
  ) => Promise<AppendUsageLedgerResult>
>(async (...args) => {
  const record = args[2]
  return {
    records: [record],
    usageTotals: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUSD: null,
      pricingComplete: false,
    },
  }
})

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => string | number>(),
    dismiss: vi.fn<(id?: string | number) => void>(),
  },
}))

vi.mock('@ai-sdk/gateway', () => ({
  createGateway: vi.fn<
    (...args: unknown[]) => {
      getGenerationInfo: (params: { id: string }) => Promise<unknown>
    }
  >(() => ({
    getGenerationInfo: vi.fn<(params: { id: string }) => Promise<unknown>>(),
  })),
}))

vi.mock('@/services/billing/enrich-gateway-cost', () => ({
  default: (...args: [EnrichGatewayCostInput]) => enrichGatewayCost(...args),
}))

vi.mock('@/services/billing/append-usage-ledger', () => ({
  default: (
    ...args: [string, string, BillableUsageRecord]
  ) => appendUsageLedger(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    getSecret: vi.fn<(key: string) => Promise<string | null>>(async () => 'test-key'),
  }),
)

vi.mock('@/services/providers/proxy-fetch', () => ({
  default: () => fetch,
}))

const usageWithTokens = (raw?: JSONObject): LanguageModelUsage => ({
  inputTokens: 1000,
  inputTokenDetails: {
    noCacheTokens: 1000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  },
  outputTokens: 500,
  outputTokenDetails: {
    textTokens: 500,
    reasoningTokens: 0,
  },
  totalTokens: 1500,
  raw,
})

describe('captureBillableUsage gateway enrich gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips enrich when provider_reported cost exists', async () => {
    const captureBillableUsage = (
      await import('@/services/billing/capture-billable-usage')
    ).default

    await captureBillableUsage({
      projectSlug: 'proj',
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          cost: '0.00849',
          generationId: 'gen_skip',
        },
      },
      settings: { version: 1 },
      onEvent: vi.fn<(event: HarnessEvent) => void>(),
    })

    expect(enrichGatewayCost).not.toHaveBeenCalled()
  })

  it('calls enrich when gateway cost is still missing', async () => {
    const captureBillableUsage = (
      await import('@/services/billing/capture-billable-usage')
    ).default

    await captureBillableUsage({
      projectSlug: 'proj',
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          generationId: 'gen_need',
        },
      },
      settings: {
        version: 1,
        'providers.custom.gateway': {
          type: 'openai-compatible',
          name: 'Gateway',
          baseURL: 'https://ai-gateway.vercel.sh/v1',
          apiKeyRef: 'gateway',
        },
      } as VixlSettings,
      onEvent: vi.fn<(event: HarnessEvent) => void>(),
    })

    // Fire-and-forget: allow the microtask to schedule enrich.
    await Promise.resolve()
    await Promise.resolve()

    expect(enrichGatewayCost).toHaveBeenCalledTimes(1)
    expect(enrichGatewayCost.mock.calls[0]?.[0]).toMatchObject({
      generationId: 'gen_need',
      projectSlug: 'proj',
      chatId: 'chat-1',
    })
  })

  it('emits billable-usage, turn-usage, chat-meta-changed after enrich success', async () => {
    const captureBillableUsage = (
      await import('@/services/billing/capture-billable-usage')
    ).default
    const onEvent = vi.fn<(event: HarnessEvent) => void>()
    const patchedRecord = {
      id: 'rec-enriched',
      chatId: 'chat-1',
      turnId: 'turn-1',
      at: '2026-01-01T00:00:00.000Z',
      source: 'main' as const,
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: { inputTokens: 10, outputTokens: 5 },
      costUSD: 0.012,
      pricingSource: 'provider_reported' as const,
      generationId: 'gen_need',
    }
    const usageTotals = {
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUSD: 0.012,
      pricingComplete: true,
    }
    enrichGatewayCost.mockResolvedValueOnce({
      record: patchedRecord,
      records: [patchedRecord],
      usageTotals,
    })

    await captureBillableUsage({
      projectSlug: 'proj',
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          generationId: 'gen_need',
        },
      },
      settings: {
        version: 1,
        'providers.custom.gateway': {
          type: 'openai-compatible',
          name: 'Gateway',
          baseURL: 'https://ai-gateway.vercel.sh/v1',
          apiKeyRef: 'gateway',
        },
      } as VixlSettings,
      onEvent,
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(enrichGatewayCost).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()

    const eventTypes = onEvent.mock.calls.map((call) => call[0].type)
    expect(eventTypes.filter((type) => type === 'billable-usage')).toHaveLength(
      2,
    )
    expect(eventTypes.filter((type) => type === 'turn-usage')).toHaveLength(2)
    expect(
      eventTypes.filter((type) => type === 'chat-meta-changed'),
    ).toHaveLength(2)

    expect(onEvent).toHaveBeenCalledWith({
      type: 'billable-usage',
      record: patchedRecord,
    })
    expect(onEvent).toHaveBeenCalledWith({
      type: 'chat-meta-changed',
      projectSlug: 'proj',
      chatId: 'chat-1',
      patch: { usageTotals },
    })
  })

  it('does not toast again when enrich soft-returns without throwing', async () => {
    const captureBillableUsage = (
      await import('@/services/billing/capture-billable-usage')
    ).default
    enrichGatewayCost.mockResolvedValueOnce({
      record: null,
      records: [],
      usageTotals: null,
    })

    await captureBillableUsage({
      projectSlug: 'proj',
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          generationId: 'gen_pending',
        },
      },
      settings: {
        version: 1,
        'providers.custom.gateway': {
          type: 'openai-compatible',
          name: 'Gateway',
          baseURL: 'https://ai-gateway.vercel.sh/v1',
          apiKeyRef: 'gateway',
        },
      } as VixlSettings,
      onEvent: vi.fn<(event: HarnessEvent) => void>(),
    })

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(enrichGatewayCost).toHaveBeenCalledTimes(1)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts once from capture catch when enrich path rejects unexpectedly', async () => {
    const captureBillableUsage = (
      await import('@/services/billing/capture-billable-usage')
    ).default
    enrichGatewayCost.mockRejectedValueOnce(new Error('keychain blew up'))

    await captureBillableUsage({
      projectSlug: 'proj',
      chatId: 'chat-1',
      turnId: 'turn-1',
      source: 'main',
      providerId: 'gateway',
      modelId: 'openai/gpt-4o',
      usage: usageWithTokens({ prompt_tokens: 10 }),
      providerMetadata: {
        gateway: {
          generationId: 'gen_fail',
        },
      },
      settings: {
        version: 1,
        'providers.custom.gateway': {
          type: 'openai-compatible',
          name: 'Gateway',
          baseURL: 'https://ai-gateway.vercel.sh/v1',
          apiKeyRef: 'gateway',
        },
      } as VixlSettings,
      onEvent: vi.fn<(event: HarnessEvent) => void>(),
    })

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledTimes(1)
    })
    expect(toast.error).toHaveBeenCalledWith('Failed to load gateway cost', {
      description: 'keychain blew up',
    })
  })
})
