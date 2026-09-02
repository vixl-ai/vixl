<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { AlertTriangle } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Spinner } from '@/components/ui/spinner'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import ChatUsageTokenMetrics from '@/components/chat/ChatUsageTokenMetrics.vue'
import type { ContextBucket } from '@/types/harness/context-bucket'
import { CONTEXT_BUCKET_META } from '@/types/harness/context-bucket-meta'
import useChatStore from '@/composables/use-chat-store'
import useContextUsage from '@/composables/use-context-usage'
import useChatContextActions from '@/composables/use-chat-context-actions'

const contextUsage = useContextUsage()
const contextActions = useChatContextActions()
const chatStore = useChatStore()
const open = ref(false)

const compactFormatter = new Intl.NumberFormat('en-US', { notation: 'compact' })

const promptUsed = computed(() => contextUsage.promptUsed.value)
const limit = computed(() => contextUsage.limit.value)
const reservedOutput = computed(() => contextUsage.reservedOutput.value)
const safetyBuffer = computed(() => contextUsage.safetyBuffer.value)
const free = computed(() => contextUsage.free.value)
const estimatedFree = computed(() => contextUsage.estimatedFree.value)
const usablePrompt = computed(() => contextUsage.usablePrompt.value)
const ratio = computed(() => contextUsage.ratio.value)
const lastStepUsage = computed(() => contextUsage.lastStepUsage.value)
const estimatedPromptUsed = computed(() => contextUsage.estimatedPromptUsed.value)

const usageTotals = computed(() => chatStore.meta.value?.usageTotals ?? null)

const sessionCostLabel = computed(() => {
  const totals = usageTotals.value
  if (!totals || totals.costUSD === null) {
    return 'Cost unknown'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(totals.costUSD)
})

const sessionPricingIncomplete = computed(() => {
  const totals = usageTotals.value
  if (!totals) {
    return false
  }
  return !totals.pricingComplete
})

const statusClass = computed(() => {
  if (ratio.value >= 0.95) {
    return 'text-destructive'
  }
  if (ratio.value >= 0.8) {
    return 'text-amber-600 dark:text-amber-400'
  }
  return 'text-muted-foreground'
})

const isHighUsage = computed(() => ratio.value >= 0.8)

const promptUsedLabel = computed(() => compactFormatter.format(promptUsed.value))
const usablePromptLabel = computed(() => compactFormatter.format(usablePrompt.value))
const limitLabel = computed(() => compactFormatter.format(limit.value))

const ringDashOffset = computed(() => {
  const circumference = 2 * Math.PI * 10
  return circumference * (1 - Math.min(1, ratio.value))
})

const visibleBuckets = computed(() => contextUsage.visibleBuckets.value)

const segmentWidth = (tokens: number): string => {
  if (limit.value <= 0) {
    return '0%'
  }
  return `${(tokens / limit.value) * 100}%`
}

const bucketBarWidth = (bucket: ContextBucket): string => segmentWidth(bucket.tokens)

const reservedBarWidth = computed(() => segmentWidth(reservedOutput.value))
const safetyBarWidth = computed(() => segmentWidth(safetyBuffer.value))
const freeBarWidth = computed(() => segmentWidth(estimatedFree.value))
const freeBarTokens = computed(() => estimatedFree.value)

const bucketColorClass = (bucket: ContextBucket): string =>
  CONTEXT_BUCKET_META[bucket.id].colorClass

const bucketShare = (bucket: ContextBucket): string => {
  const base = estimatedPromptUsed.value
  if (base <= 0) {
    return '0%'
  }
  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(bucket.tokens / base)
}

const formatTokens = (tokens: number): string => compactFormatter.format(tokens)

const safetyBufferLabel = computed(() => formatTokens(safetyBuffer.value))
const reservedOutputLabel = computed(() => formatTokens(reservedOutput.value))
const freeLabel = computed(() => formatTokens(free.value))

const showManageActions = computed(
  () =>
    isHighUsage.value ||
    Boolean(contextActions.onCompact.value) ||
    Boolean(contextActions.onHandoff.value),
)

const handleCompact = async (): Promise<void> => {
  if (contextActions.compacting.value) {
    return
  }
  try {
    await contextActions.onCompact.value?.()
  } catch (error) {
    toast.error('Failed to compact chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleHandoff = async (): Promise<void> => {
  try {
    await contextActions.onHandoff.value?.()
  } catch (error) {
    toast.error('Failed to hand off chat', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 gap-1.5 px-2 text-xs"
        :class="statusClass"
        :disabled="
          contextActions.triggerDisabled.value ||
            contextUsage.pending.value ||
            contextActions.compacting.value
        "
      >
        <svg
          aria-hidden="true"
          class="size-5 shrink-0"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            class="opacity-25"
          />
          <circle
            cx="12"
            cy="12"
            r="10"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            class="opacity-80"
            :stroke-dasharray="`${2 * Math.PI * 10} ${2 * Math.PI * 10}`"
            :stroke-dashoffset="ringDashOffset"
            style="transform: rotate(-90deg); transform-origin: center"
          />
        </svg>
      </Button>
    </PopoverTrigger>

    <PopoverContent align="end" class="w-84 divide-y overflow-hidden p-0">
      <div class="space-y-2 p-3">
        <div class="flex items-center justify-between gap-3 text-xs">
          <p class="font-medium">
            Estimated context window
          </p>
          <p class="text-muted-foreground">
            {{ limitLabel }} limit
          </p>
        </div>
        <div class="flex items-center justify-between gap-3 text-xs">
          <p
            class="font-medium"
            :class="statusClass"
          >
            {{ promptUsedLabel }} / {{ usablePromptLabel }} usable
          </p>
        </div>

        <div
          v-if="usageTotals"
          class="flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span class="tabular-nums">Session {{ sessionCostLabel }}</span>
          <Tooltip v-if="sessionPricingIncomplete">
            <TooltipTrigger as-child>
              <span class="inline-flex shrink-0">
                <AlertTriangle
                  class="size-3 text-amber-600 dark:text-amber-400"
                  aria-hidden="true"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent>Some usage has no price</TooltipContent>
          </Tooltip>
        </div>

        <div
          v-if="limit > 0"
          class="flex h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            v-for="bucket in visibleBuckets"
            :key="bucket.id"
            :class="bucketColorClass(bucket)"
            :style="{ width: bucketBarWidth(bucket) }"
            :title="`${bucket.label}: ${formatTokens(bucket.tokens)}`"
          />
          <div
            :style="{ width: reservedBarWidth }"
            class="bg-muted-foreground/40"
            :title="`Reserved for reply: ${reservedOutputLabel}`"
          />
          <div
            v-if="safetyBuffer > 0"
            :style="{ width: safetyBarWidth }"
            class="bg-muted-foreground/25"
            :title="`Safety buffer: ${safetyBufferLabel}`"
          />
          <div
            v-if="freeBarTokens > 0"
            :style="{ width: freeBarWidth }"
            class="bg-muted-foreground/15"
            :title="`Free: ${formatTokens(freeBarTokens)}`"
          />
        </div>
      </div>

      <div class="space-y-3 p-3">
        <ul class="space-y-2">
          <li
            v-for="bucket in visibleBuckets"
            :key="bucket.id"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span
                class="size-2 shrink-0 rounded-full"
                :class="bucketColorClass(bucket)"
              />
              <span class="truncate">{{ bucket.label }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-2 tabular-nums text-foreground">
              <span class="text-muted-foreground">{{ bucketShare(bucket) }}</span>
              <span>{{ formatTokens(bucket.tokens) }}</span>
            </span>
          </li>

          <li
            v-if="reservedOutput > 0"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span class="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
              <span class="truncate">Reserved for reply</span>
            </span>
            <span class="shrink-0 tabular-nums text-foreground">
              {{ reservedOutputLabel }}
            </span>
          </li>

          <li
            v-if="safetyBuffer > 0"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span class="size-2 shrink-0 rounded-full bg-muted-foreground/25" />
              <span class="truncate">Safety buffer</span>
            </span>
            <span class="shrink-0 tabular-nums text-foreground">
              {{ safetyBufferLabel }}
            </span>
          </li>

          <li
            v-if="free > 0"
            class="flex items-center justify-between gap-3 text-xs"
          >
            <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
              <span class="size-2 shrink-0 rounded-full bg-muted-foreground/15" />
              <span class="truncate">Free</span>
            </span>
            <span class="shrink-0 tabular-nums text-foreground">
              {{ freeLabel }}
            </span>
          </li>
        </ul>

        <div
          v-if="lastStepUsage"
          class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
        >
          <span>Last API step (provider-reported):</span>
          <ChatUsageTokenMetrics
            :input-tokens="lastStepUsage.inputTokens"
            :output-tokens="lastStepUsage.outputTokens"
            :cache-read-tokens="lastStepUsage.cacheReadTokens"
            :cache-write-tokens="lastStepUsage.cacheWriteTokens"
          />
        </div>

        <p
          v-if="visibleBuckets.length === 0"
          class="text-xs text-muted-foreground"
        >
          No context counted yet. Select a model to estimate usage.
        </p>
      </div>

      <div
        v-if="showManageActions"
        class="flex items-center gap-2 p-3"
      >
        <p
          v-if="isHighUsage"
          class="min-w-0 flex-1 text-xs"
          :class="statusClass"
        >
          {{ ratio >= 0.95 ? 'Context nearly full.' : 'Context getting full.' }}
        </p>
        <div
          v-else
          class="min-w-0 flex-1 text-xs text-muted-foreground"
        >
          Manage context
        </div>
        <Button
          v-if="contextActions.onCompact.value"
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="
            contextActions.actionsDisabled.value || contextActions.compacting.value
          "
          :aria-busy="contextActions.compacting.value"
          :aria-label="contextActions.compacting.value ? 'Compacting...' : undefined"
          @click="handleCompact"
        >
          <Spinner
            v-if="contextActions.compacting.value"
            class="size-3"
          />
          {{ contextActions.compacting.value ? 'Compacting...' : 'Compact' }}
        </Button>
        <Button
          v-if="contextActions.onHandoff.value"
          type="button"
          variant="outline"
          size="sm"
          class="h-7 px-2 text-xs"
          :disabled="
            contextActions.actionsDisabled.value || contextActions.compacting.value
          "
          @click="handleHandoff"
        >
          Handoff
        </Button>
      </div>
    </PopoverContent>
  </Popover>
</template>
