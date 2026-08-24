import { toast } from 'vue-sonner'
import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModelUsage } from 'ai'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import recordBillableUsage from '@/services/billing/record-billable-usage'
import appendUsageLedger from '@/services/billing/append-usage-ledger'
import aggregateTurnUsage from '@/services/billing/aggregate-turn-usage'
import enrichGatewayCost from '@/services/billing/enrich-gateway-cost'
import { getSecret } from '@/services/vixl/vixl-tauri'
import {
  getCustomProvider,
  keychainKeyForProvider,
} from '@/services/providers/registry'
import proxyFetch from '@/services/providers/proxy-fetch'

const gatewayGenerationId = (providerMetadata: unknown): string | undefined => {
  if (!providerMetadata || typeof providerMetadata !== 'object') {
    return undefined
  }
  const gateway = (providerMetadata as Record<string, unknown>).gateway
  if (!gateway || typeof gateway !== 'object') {
    return undefined
  }
  const generationId = (gateway as Record<string, unknown>).generationId
  return typeof generationId === 'string' && generationId.length > 0
    ? generationId
    : undefined
}

const resolveGatewayApiKey = async (
  settings: VixlSettings,
): Promise<string | undefined> => {
  const custom = getCustomProvider(settings, 'gateway')
  const ref =
    custom?.apiKeyRef ??
    (settings['providers.gateway.apiKeyRef' as keyof VixlSettings] as
      | string
      | undefined)
  if (!ref) {
    return undefined
  }
  return (await getSecret(keychainKeyForProvider(ref))) ?? undefined
}

/**
 * Record, persist, and emit billable usage + turn aggregate + chat meta rollup.
 * For gateway, kicks off async cost enrich when provider cost is still missing
 * (does not await).
 */
export default async (input: {
  projectSlug: string
  chatId: string
  turnId: string
  source: BillableUsageRecord['source']
  providerId: string
  modelId: string
  usage: LanguageModelUsage | undefined
  providerMetadata?: unknown
  responseId?: string
  subagentId?: string
  settings: VixlSettings
  customModel?: VixlCustomProviderModel
  onEvent: (event: HarnessEvent) => void
}): Promise<BillableUsageRecord> => {
  const generationId = gatewayGenerationId(input.providerMetadata)

  const record = recordBillableUsage({
    chatId: input.chatId,
    turnId: input.turnId,
    source: input.source,
    providerId: input.providerId,
    modelId: input.modelId,
    usage: input.usage,
    providerMetadata: input.providerMetadata,
    responseId: input.responseId,
    generationId,
    subagentId: input.subagentId,
    settings: input.settings,
    customModel: input.customModel,
  })

  input.onEvent({ type: 'billable-usage', record })

  try {
    const { records, usageTotals } = await appendUsageLedger(
      input.projectSlug,
      input.chatId,
      record,
    )

    input.onEvent({
      type: 'turn-usage',
      aggregate: aggregateTurnUsage(records, input.turnId),
    })
    input.onEvent({
      type: 'chat-meta-changed',
      projectSlug: input.projectSlug,
      chatId: input.chatId,
      patch: { usageTotals },
    })
  } catch (error) {
    toast.error('Failed to save usage', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  // Skip enrich when metadata/raw already supplied provider_reported cost.
  const needsGatewayCostEnrich =
    input.providerId === 'gateway' &&
    Boolean(generationId) &&
    (record.costUSD === null || record.pricingSource !== 'provider_reported')

  if (needsGatewayCostEnrich && generationId) {
    const recordId = record.id
    const turnId = input.turnId
    const projectSlug = input.projectSlug
    const chatId = input.chatId
    const onEvent = input.onEvent
    const settings = input.settings

    resolveGatewayApiKey(settings)
      .then(async (apiKey) => {
        const gatewayClient = createGateway({
          apiKey: apiKey || undefined,
          fetch: proxyFetch(),
        })
        const result = await enrichGatewayCost({
          projectSlug,
          chatId,
          recordId,
          generationId,
          gatewayClient,
        })
        if (result.record) {
          onEvent({ type: 'billable-usage', record: result.record })
          onEvent({
            type: 'turn-usage',
            aggregate: aggregateTurnUsage(result.records, turnId),
          })
        }
        if (result.usageTotals) {
          onEvent({
            type: 'chat-meta-changed',
            projectSlug,
            chatId,
            patch: { usageTotals: result.usageTotals },
          })
        }
      })
      .catch((error: unknown) => {
        // Key/client construction failures only. Enrich soft-returns pending
        // and toasts its own hard failures without rethrowing.
        toast.error('Failed to load gateway cost', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
  }

  return record
}
