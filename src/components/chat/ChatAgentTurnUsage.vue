<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import type { BillableUsageRecord } from '@/types/billing/billable-usage-record'
import type { TurnUsageAggregate } from '@/types/billing/turn-usage-aggregate'
import useAgentHarness from '@/composables/use-agent-harness'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { HOME_CHAT_SLUG, isHomeChatSlug } from '@/constants/home-chat'
import ChatUsageTokenMetrics from '@/components/chat/ChatUsageTokenMetrics.vue'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'

const props = defineProps<{
  turnId: string
}>()

const route = useRoute()
const chatStore = useChatStore()
const fleet = useFleetRegistry()

const isStandalone =
  route.name === 'home-chat' ||
  route.name === 'home-chat-subagent' ||
  isHomeChatSlug(String(route.params.slug ?? ''))

const projectSlug = isStandalone ? HOME_CHAT_SLUG : String(route.params.slug ?? '')
const chatId = String(route.params.chatId ?? '')

const sessionMeta = chatStore.forChat(projectSlug, chatId).meta.value
const project = fleet.projects.value.find((item) => item.slug === projectSlug)

const harness = useAgentHarness({
  projectSlug,
  chatId,
  projectRoot: sessionMeta?.projectRoot ?? project?.rootPath ?? '',
  projectName: isStandalone ? 'Home' : (project?.name ?? projectSlug),
  standalone: isStandalone,
})

const formatCostUsd = (cost: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(cost)

const aggregate = computed((): TurnUsageAggregate | null => {
  if (!chatId || !props.turnId) {
    return null
  }
  return harness.turnUsageByTurnId.value[props.turnId] ?? null
})

const costLabel = computed(() => {
  const usage = aggregate.value
  if (!usage || usage.costUSD === null) {
    return 'Cost unknown'
  }
  return formatCostUsd(usage.costUSD)
})

const showWarning = computed(() => {
  const usage = aggregate.value
  if (!usage) {
    return false
  }
  return usage.usageMissing || !usage.pricingComplete
})

const warningText = computed(() => {
  const usage = aggregate.value
  if (!usage) {
    return ''
  }
  if (usage.usageMissing) {
    return 'Provider did not return usage'
  }
  if (!usage.pricingComplete) {
    return 'Some usage has no price'
  }
  return ''
})

const partLabel = (part: BillableUsageRecord): string => {
  if (part.source === 'main') {
    return 'Main'
  }
  if (part.source === 'subagent') {
    if (part.subagentId) {
      const subagent = chatStore.forChat(projectSlug, chatId).getSubagent(part.subagentId)
      const name = subagent?.name?.trim()
      if (name) {
        return `Subagent ${name}`
      }
    }
    return 'Subagent'
  }
  if (part.source === 'compaction') {
    return 'Compaction'
  }
  if (part.source === 'title') {
    return 'Title'
  }
  return 'Other'
}

const partCostLabel = (part: BillableUsageRecord): string => {
  if (part.costUSD === null) {
    return 'Cost unknown'
  }
  return formatCostUsd(part.costUSD)
}

const showTooltip = computed(() => showWarning.value || (aggregate.value?.parts.length ?? 0) > 0)
</script>

<template>
  <div v-if="aggregate" class="flex max-w-prose items-center gap-1.5 text-xs text-muted-foreground">
    <Tooltip v-if="showTooltip">
      <TooltipTrigger as-child>
        <div class="inline-flex min-w-0 items-center gap-1.5">
          <span class="tabular-nums">{{ costLabel }}</span>
          <ChatUsageTokenMetrics
            :input-tokens="aggregate.inputTokens"
            :output-tokens="aggregate.outputTokens"
            :cache-read-tokens="aggregate.cacheReadTokens"
            :cache-write-tokens="aggregate.cacheWriteTokens"
          />
          <AppIcon
            name="triangle-alert"
            v-if="showWarning"
            class="size-3 shrink-0 text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
        </div>
      </TooltipTrigger>
      <TooltipContent class="max-w-xs space-y-1.5">
        <p v-if="warningText" class="font-medium">
          {{ warningText }}
        </p>
        <ul v-if="aggregate.parts.length > 0" class="space-y-1">
          <li v-for="part in aggregate.parts" :key="part.id" class="flex flex-col gap-0.5">
            <span class="font-medium">{{ partLabel(part) }}</span>
            <span class="flex flex-wrap items-center gap-1.5 text-muted-foreground">
              <span class="tabular-nums">{{ partCostLabel(part) }}</span>
              <ChatUsageTokenMetrics
                :input-tokens="part.usage.inputTokens ?? 0"
                :output-tokens="part.usage.outputTokens ?? 0"
                :cache-read-tokens="part.usage.cacheReadTokens ?? 0"
                :cache-write-tokens="part.usage.cacheWriteTokens ?? 0"
              />
            </span>
          </li>
        </ul>
      </TooltipContent>
    </Tooltip>
    <template v-else>
      <span class="tabular-nums">{{ costLabel }}</span>
      <ChatUsageTokenMetrics
        :input-tokens="aggregate.inputTokens"
        :output-tokens="aggregate.outputTokens"
        :cache-read-tokens="aggregate.cacheReadTokens"
        :cache-write-tokens="aggregate.cacheWriteTokens"
      />
    </template>
  </div>
</template>
