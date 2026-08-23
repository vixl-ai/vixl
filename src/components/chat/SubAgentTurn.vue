<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleAlertIcon,
  OctagonXIcon,
  SquareIcon,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import NavigationAsideLeftChatRunningDots from '@/components/navigation/aside/left/ChatRunningDots.vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import { HOME_CHAT_SLUG, isHomeChatSlug } from '@/constants/home-chat'
import chatRouteFor from '@/utils/chat-route-for'
import deriveSubagentActivity from '@/utils/derive-subagent-activity'
import formatModelLabelFromRef from '@/utils/format-model-label-from-ref'

const props = defineProps<{
  subagent: SubagentTimelineItem
}>()

const emit = defineEmits<{
  stopSubagent: [subagentId: string]
}>()

const route = useRoute()
const router = useRouter()

const isRunning = computed(() => props.subagent.status === 'running')
const modelLabel = computed(() => formatModelLabelFromRef(props.subagent.model))
const displayName = computed(() => props.subagent.name.trim() || 'Sub-agent')
const activityLabel = computed(() => deriveSubagentActivity(props.subagent))

const statusIcon = computed(() => {
  if (props.subagent.status === 'stopped') {
    return OctagonXIcon
  }
  if (props.subagent.status === 'error') {
    return CircleAlertIcon
  }
  return CheckCircle2Icon
})

const statusIconClass = computed(() => {
  if (props.subagent.status === 'error') {
    return 'size-3.5 shrink-0 fill-none text-destructive'
  }
  if (props.subagent.status === 'stopped') {
    return 'size-3.5 shrink-0 fill-none text-destructive'
  }
  return 'size-3.5 shrink-0 fill-none text-emerald-500'
})

const openSubagentChat = async (): Promise<void> => {
  const chatId = String(route.params.chatId ?? '')
  if (!chatId) {
    toast.error('Chat not found')
    return
  }
  const isStandalone =
    route.name === 'home-chat' ||
    route.name === 'home-chat-subagent' ||
    isHomeChatSlug(String(route.params.slug ?? ''))
  const projectSlug = isStandalone
    ? HOME_CHAT_SLUG
    : String(route.params.slug ?? '')
  try {
    await router.push(
      chatRouteFor(projectSlug, chatId, props.subagent.subagentId),
    )
  } catch (error) {
    toast.error('Failed to open sub-agent', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleStop = (): void => {
  emit('stopSubagent', props.subagent.subagentId)
}
</script>

<template>
  <div class="flex w-full max-w-full items-center gap-1">
    <button
      type="button"
      class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      @click="openSubagentChat"
    >
      <NavigationAsideLeftChatRunningDots
        v-if="isRunning"
      />
      <component
        :is="statusIcon"
        v-else
        :class="statusIconClass"
      />
      <span class="min-w-0 flex-1">
        <span
          v-if="modelLabel"
          class="block truncate text-[10px] leading-tight text-muted-foreground/80"
        >{{ modelLabel }}</span>
        <span class="block truncate text-foreground/90">{{ displayName }}</span>
        <AiElementsShimmerShimmer
          v-if="activityLabel"
          :duration="1"
          as="span"
          class="block min-w-0 truncate text-[10px] leading-tight"
        >
          {{ activityLabel }}
        </AiElementsShimmerShimmer>
      </span>
      <Tooltip v-if="isRunning">
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            class="size-6 shrink-0 text-destructive hover:text-destructive"
            aria-label="Stop sub-agent"
            @click.stop="handleStop"
          >
            <SquareIcon class="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Stop sub-agent</TooltipContent>
      </Tooltip>
      <ChevronRightIcon class="size-3.5 shrink-0 opacity-60" />
    </button>
  </div>
</template>
