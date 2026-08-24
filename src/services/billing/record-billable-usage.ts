import type { LanguageModelUsage } from 'ai'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { PricingSource } from '@/types/billing/pricing-source'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import normalizeLanguageModelUsage from '@/services/billing/normalize-language-model-usage'
import extractCacheWriteFromRaw from '@/services/billing/extract-cache-write-from-raw'
import extractOpenaiCompatibleCost from '@/services/billing/extract-openai-compatible-cost'
import extractGatewayMetadataCost from '@/services/billing/extract-gateway-metadata-cost'
import resolveModelPricing from '@/services/billing/resolve-model-pricing'
import computeCostFromRates from '@/services/billing/compute-cost-from-rates'
import { getCustomProvider } from '@/services/providers/registry'

type RecordBillableUsageInput = {
  chatId: string
  turnId: string
  source: BillableUsageRecord['source']
  providerId: string
  modelId: string
  usage: LanguageModelUsage | undefined
  providerMetadata?: unknown
  responseId?: string
  generationId?: string
  subagentId?: string
  settings: VixlSettings
  customModel?: VixlCustomProviderModel
  at?: string
}

/**
 * Build a BillableUsageRecord from an AI SDK usage snapshot.
 * Does not persist; callers append via append-usage-ledger.
 */
export default (input: RecordBillableUsageInput): BillableUsageRecord => {
  const normalized = normalizeLanguageModelUsage(input.usage)
  const { usageMissing, ...usageFields } = normalized

  const cacheWriteTokens = extractCacheWriteFromRaw(
    usageFields,
    usageFields.raw,
  )
  const usage: BillableUsageRecord['usage'] = { ...usageFields }
  if (cacheWriteTokens !== undefined) {
    usage.cacheWriteTokens = cacheWriteTokens
  }

  let costUSD: number | null = null
  let pricingSource: PricingSource = 'none'
  let rates: BillableUsageRecord['rates']

  const rawCost = extractOpenaiCompatibleCost(usage.raw)
  const custom = getCustomProvider(input.settings, input.providerId)
  const isOpenAiCompatible = Boolean(custom)

  if (input.providerId === 'gateway') {
    // Prefer sync providerMetadata.gateway cost. Leave null for async
    // getGenerationInfo enrich only when metadata AND raw have no cost.
    const metadataCost = extractGatewayMetadataCost(input.providerMetadata)
    if (metadataCost !== null) {
      costUSD = metadataCost
      pricingSource = 'provider_reported'
    } else if (rawCost.costUSD !== null) {
      costUSD = rawCost.costUSD
      pricingSource = 'provider_reported'
    }
  } else if (isOpenAiCompatible && rawCost.costUSD !== null) {
    costUSD = rawCost.costUSD
    pricingSource = 'provider_reported'
  }

  if (pricingSource !== 'provider_reported') {
    const resolved = resolveModelPricing({
      providerId: input.providerId,
      modelId: input.modelId,
      settings: input.settings,
      customModel: input.customModel,
    })
    if (resolved) {
      rates = resolved
      costUSD = computeCostFromRates(usage, resolved)
      pricingSource = 'user_configured'
    }
  }

  const record: BillableUsageRecord = {
    id: crypto.randomUUID(),
    chatId: input.chatId,
    turnId: input.turnId,
    at: input.at ?? new Date().toISOString(),
    source: input.source,
    providerId: input.providerId,
    modelId: input.modelId,
    usage,
    costUSD,
    pricingSource,
  }

  if (input.subagentId !== undefined) {
    record.subagentId = input.subagentId
  }
  if (input.providerMetadata !== undefined) {
    record.providerMetadata = input.providerMetadata
  }
  if (input.responseId !== undefined) {
    record.responseId = input.responseId
  }
  if (input.generationId !== undefined) {
    record.generationId = input.generationId
  }
  if (usageMissing) {
    record.usageMissing = true
  }
  if (rates) {
    record.rates = rates
  }

  return record
}
