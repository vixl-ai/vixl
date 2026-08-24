import type { ChatAttention } from '@/types/chat/chat-attention'
import type { AwaitingPlanGo } from '@/types/plans/awaiting-plan-go'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'

export type ChatStatus = 'idle' | 'running'

/** Rollup from the usage ledger; ledger rows remain the source of truth. */
export type ChatUsageTotals = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costUSD: number | null
  pricingComplete: boolean
}

export type ChatMeta = {
  id: string
  title: string
  projectSlug: string
  projectRoot: string
  mode: VixlChatMode
  model: string
  status: ChatStatus
  attention?: ChatAttention
  createdAt: string
  updatedAt: string
  forkedFrom: string | null
  pinned: boolean
  pinnedAt: string | null
  prefixSnapshot?: PrefixSnapshot
  activeContext?: {
    checkpointLineId?: string
    includeFromCreatedAt?: string
    summary?: string
  }
  awaitingPlanGo?: AwaitingPlanGo | null
  subagentModel?: string | null
  reasoning?: string | null
  subagentReasoning?: string | null
  usageTotals?: ChatUsageTotals
}
