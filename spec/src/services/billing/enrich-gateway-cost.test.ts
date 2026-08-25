import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

type GenerationInfo = {
  totalCost: number
  upstreamInferenceCost: number
  isByok: boolean
}

const readUsageLedger = vi.fn<
  (projectSlug: string, chatId: string) => Promise<BillableUsageRecord[]>
>()

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => string | number>(() => 'info-toast-id'),
    dismiss: vi.fn<(id?: string | number) => void>(),
  },
}))

vi.mock('@/services/billing/read-usage-ledger', () => ({
  default: (...args: [string, string]) => readUsageLedger(...args),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    getUserVixlDir: vi.fn<() => Promise<string>>(async () => '/tmp/vixl'),
    writeChatUsage: vi.fn<
      (
        projectSlug: string,
        chatId: string,
        records: unknown[],
      ) => Promise<void>
    >(async () => undefined),
    updateChatMeta: vi.fn<
      (
        projectSlug: string,
        chatId: string,
        patch: Record<string, unknown>,
      ) => Promise<unknown>
    >(async () => undefined),
    readJsonFile: vi.fn<(path: string) => Promise<unknown>>(async () => []),
  }),
)

const baseRecord = (): BillableUsageRecord => ({
  id: 'rec-1',
  chatId: 'chat-1',
  turnId: 'turn-1',
  at: '2026-01-01T00:00:00.000Z',
  source: 'main',
  providerId: 'gateway',
  modelId: 'openai/gpt-4o',
  usage: { inputTokens: 10, outputTokens: 5 },
  costUSD: null,
  pricingSource: 'none',
  generationId: 'gen-1',
})

describe('enrichGatewayCost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readUsageLedger.mockResolvedValue([baseRecord()])
  })

  it('soft pending (not-found / Invalid error response format): no toast, ledger unchanged', async () => {
    const enrichGatewayCost = (
      await import('@/services/billing/enrich-gateway-cost')
    ).default
    const vixl = await import('@/services/vixl/vixl-tauri')
    const delay = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const getGenerationInfo = vi.fn<
      (params: { id: string }) => Promise<GenerationInfo>
    >(async () => {
      throw Object.assign(
        new Error('Invalid error response format: Gateway request failed'),
        {
          name: 'GatewayResponseError',
          response: { error: 'Usage event not found' },
        },
      )
    })

    const result = await enrichGatewayCost({
      projectSlug: 'proj',
      chatId: 'chat-1',
      recordId: 'rec-1',
      generationId: 'gen-1',
      gatewayClient: { getGenerationInfo },
      delay,
    })

    expect(getGenerationInfo).toHaveBeenCalledTimes(4)
    expect(delay).toHaveBeenCalledTimes(3)
    expect(delay.mock.calls.map((call) => call[0])).toEqual([2000, 2000, 4000])
    expect(toast.error).not.toHaveBeenCalled()
    expect(vixl.writeChatUsage).not.toHaveBeenCalled()
    expect(vixl.updateChatMeta).not.toHaveBeenCalled()
    expect(result.record).toBeNull()
    expect(result.usageTotals).toBeNull()
    expect(result.records[0]?.costUSD).toBeNull()
    expect(result.records[0]?.pricingSource).toBe('none')
  })

  it('success after retry: pending then succeeds; cost patched; no toast', async () => {
    const enrichGatewayCost = (
      await import('@/services/billing/enrich-gateway-cost')
    ).default
    const vixl = await import('@/services/vixl/vixl-tauri')
    const delay = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const getGenerationInfo = vi
      .fn<(params: { id: string }) => Promise<GenerationInfo>>()
      .mockRejectedValueOnce(
        new Error('Invalid error response format: Gateway request failed'),
      )
      .mockResolvedValueOnce({
        totalCost: 0.012,
        upstreamInferenceCost: 0.01,
        isByok: false,
      })

    const result = await enrichGatewayCost({
      projectSlug: 'proj',
      chatId: 'chat-1',
      recordId: 'rec-1',
      generationId: 'gen-1',
      gatewayClient: { getGenerationInfo },
      delay,
    })

    expect(getGenerationInfo).toHaveBeenCalledTimes(2)
    expect(delay).toHaveBeenCalledTimes(1)
    expect(delay).toHaveBeenCalledWith(2000)
    expect(toast.error).not.toHaveBeenCalled()
    expect(vixl.writeChatUsage).toHaveBeenCalledTimes(1)
    expect(vixl.updateChatMeta).toHaveBeenCalledTimes(1)
    expect(result.record?.costUSD).toBe(0.012)
    expect(result.record?.pricingSource).toBe('provider_reported')
    expect(result.usageTotals?.costUSD).toBe(0.012)
  })

  it('hard failure after retries: toast.error called; ledger unchanged', async () => {
    const enrichGatewayCost = (
      await import('@/services/billing/enrich-gateway-cost')
    ).default
    const vixl = await import('@/services/vixl/vixl-tauri')
    const delay = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const getGenerationInfo = vi.fn<
      (params: { id: string }) => Promise<GenerationInfo>
    >(async () => {
      throw new Error('Unauthorized')
    })

    const result = await enrichGatewayCost({
      projectSlug: 'proj',
      chatId: 'chat-1',
      recordId: 'rec-1',
      generationId: 'gen-1',
      gatewayClient: { getGenerationInfo },
      delay,
    })

    expect(getGenerationInfo).toHaveBeenCalledTimes(1)
    expect(delay).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Failed to load gateway cost', {
      description: 'Unauthorized',
    })
    expect(vixl.writeChatUsage).not.toHaveBeenCalled()
    expect(vixl.updateChatMeta).not.toHaveBeenCalled()
    expect(result.record?.costUSD).toBeNull()
    expect(result.record?.pricingSource).toBe('none')
    expect(result.records[0]?.costUSD).toBeNull()
  })

  it('maps BYOK cost via upstreamInferenceCost', async () => {
    const enrichGatewayCost = (
      await import('@/services/billing/enrich-gateway-cost')
    ).default
    const delay = vi.fn<(ms: number) => Promise<void>>(async () => undefined)
    const getGenerationInfo = vi.fn<
      (params: { id: string }) => Promise<GenerationInfo>
    >(async () => ({
      totalCost: 0.0001,
      upstreamInferenceCost: 0.00849,
      isByok: true,
    }))

    const result = await enrichGatewayCost({
      projectSlug: 'proj',
      chatId: 'chat-1',
      recordId: 'rec-1',
      generationId: 'gen-1',
      gatewayClient: { getGenerationInfo },
      delay,
    })

    expect(result.record?.costUSD).toBe(0.00849)
    expect(result.record?.pricingSource).toBe('provider_reported')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
