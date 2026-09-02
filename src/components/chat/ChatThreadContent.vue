<script setup lang="ts">
import { computed, nextTick, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { McpConfig } from '@/types/vixl/mcp-config'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import ChatAgentTurn from '@/components/chat/ChatAgentTurn.vue'
import ChatCompactionMarker from '@/components/chat/ChatCompactionMarker.vue'
import ChatMessageTurn from '@/components/chat/ChatMessageTurn.vue'
import ChatMcpAuthCard from '@/components/chat/ChatMcpAuthCard.vue'
import ChatQuestionCard from '@/components/chat/ChatQuestionCard.vue'
import ChatSubAgentTurn from '@/components/chat/SubAgentTurn.vue'
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/shadcn/ui/message-scroller'
import { useMessageScrollerContext } from '@/components/shadcn/ui/message-scroller/useMessageScroller'
import deriveAgentActivity from '@/utils/derive-agent-activity'

const props = defineProps<{
  timeline: ChatTimelineItem[]
  status?: ChatStatus
  pendingApprovals: PendingApprovalView[]
  pendingQuestion?: PendingQuestionState | null
  pendingMcpAuth?: PendingMcpAuthView[]
  personalMcp?: McpConfig
  projectMcp?: McpConfig
  readOnly?: boolean
  compacting?: boolean
}>()

const emit = defineEmits<{
  submitAnswer: [toolCallId: string, answer: string]
  authenticateMcp: [toolCallId: string]
  skipMcpAuth: [toolCallId: string]
  openMcpSettings: [serverId: string]
  secretsSavedMcp: [toolCallId: string, serverId: string]
  retry: []
  restoreFiles: [turnId: string]
  stopSubagent: [subagentId: string]
}>()

const { scrollToEnd } = useMessageScroller()
const { handleContentChange } = useMessageScrollerContext()

const isLive = computed(() => props.status === 'streaming' || props.status === 'submitted')

const runningSubagents = computed(() =>
  props.timeline.filter(
    (item): item is SubagentTimelineItem =>
      item.type === 'subagent' && item.status === 'running',
  ),
)

const lastAgentTurn = computed(() => {
  for (let index = props.timeline.length - 1; index >= 0; index -= 1) {
    const item = props.timeline[index]
    if (item?.type === 'agent-turn') {
      return item.turn
    }
  }
  return null
})

const activityLabel = computed(() =>
  deriveAgentActivity({
    status: props.status ?? 'ready',
    turn: lastAgentTurn.value,
    runningSubagents: runningSubagents.value,
    hasPendingApproval: props.pendingApprovals.length > 0,
    hasPendingQuestion: Boolean(props.pendingQuestion),
    hasPendingMcpAuth: (props.pendingMcpAuth?.length ?? 0) > 0,
  }),
)

const activeMcpAuth = computed(() => {
  if (props.pendingQuestion) {
    return null
  }
  const queue = props.pendingMcpAuth ?? []
  return queue[0] ?? null
})

const subagentsByToolCallId = computed(() => {
  const map = new Map<string, SubagentTimelineItem>()
  for (const item of props.timeline) {
    if (item.type === 'subagent' && item.toolCallId) {
      map.set(item.toolCallId, item)
    }
  }
  return map
})

const subagentsById = computed(() => {
  const map = new Map<string, SubagentTimelineItem>()
  for (const item of props.timeline) {
    if (item.type === 'subagent') {
      map.set(item.subagentId, item)
    }
  }
  return map
})

const subagentRevision = computed(() =>
  props.timeline
    .filter((item): item is SubagentTimelineItem => item.type === 'subagent')
    .map((item) => `${item.subagentId}:${item.status}:${item.summary?.length ?? 0}`)
    .join('|'),
)

const streamRevision = computed(() => {
  const last = props.timeline.at(-1)
  if (last?.type === 'subagent') {
    return [
      props.timeline.length,
      last.subagentId,
      last.status,
      last.summary?.length ?? 0,
      subagentRevision.value,
    ].join(':')
  }
  if (last?.type === 'todo') {
    // Todos render beside the prompt, not in the scroll thread.
    const prior = props.timeline.at(-2)
    if (prior?.type === 'agent-turn') {
      return [
        props.timeline.length,
        prior.turn.text.length,
        prior.turn.steps
          .map(
            (step) =>
              `${step.text.length}:${step.reasoning.length}:${step.tools.length}`,
          )
          .join(';'),
        subagentRevision.value,
      ].join(':')
    }
    return `${props.timeline.length}:${subagentRevision.value}`
  }
  if (last?.type !== 'agent-turn') {
    return `${props.timeline.length}:${subagentRevision.value}`
  }
  const turn = last.turn
  return [
    props.timeline.length,
    turn.text.length,
    turn.steps
      .map(
        (step) =>
          `${step.text.length}:${step.reasoning.length}:${step.tools.length}:${step.tools
            .map((tool) => `${tool.toolCallId}:${tool.status}`)
            .join('|')}`,
      )
      .join(';'),
    subagentRevision.value,
  ].join(':')
})

const claimedSubagentKeys = computed(() => {
  const toolCallIds = new Set<string>()
  const subagentIds = new Set<string>()
  for (const item of props.timeline) {
    if (item.type !== 'agent-turn') {
      continue
    }
    for (const step of item.turn.steps) {
      for (const tool of step.tools) {
        if (tool.name !== 'spawn_subagent') {
          continue
        }
        toolCallIds.add(tool.toolCallId)
        if (tool.result && typeof tool.result === 'object') {
          const result = tool.result as Record<string, unknown>
          if (typeof result.subagentId === 'string' && result.subagentId.length > 0) {
            subagentIds.add(result.subagentId)
          }
        }
      }
    }
  }
  for (const item of props.timeline) {
    if (
      item.type === 'subagent' &&
      item.toolCallId &&
      toolCallIds.has(item.toolCallId)
    ) {
      subagentIds.add(item.subagentId)
    }
  }
  return { toolCallIds, subagentIds }
})

const visibleTimeline = computed(() => {
  const claimed = claimedSubagentKeys.value
  return props.timeline.filter((item) => {
    if (item.type === 'todo') {
      return false
    }
    if (item.type !== 'subagent') {
      return true
    }
    if (item.toolCallId && claimed.toolCallIds.has(item.toolCallId)) {
      return false
    }
    if (claimed.subagentIds.has(item.subagentId)) {
      return false
    }
    return true
  })
})

const timelineItemId = (item: ChatTimelineItem, index: number): string => {
  if (item.type === 'user') {
    return item.message.id
  }
  if (item.type === 'subagent') {
    return `subagent-${item.subagentId}`
  }
  if (item.type === 'agent-turn') {
    return item.turn.id || `turn-${index}`
  }
  return `item-${index}`
}

const isLastItem = (index: number): boolean => index === visibleTimeline.value.length - 1

const lastVisibleAgentTurnIndex = computed(() => {
  let lastIndex = -1
  for (let index = 0; index < visibleTimeline.value.length; index += 1) {
    if (visibleTimeline.value[index]?.type === 'agent-turn') {
      lastIndex = index
    }
  }
  return lastIndex
})

const activityOnLastAgentTurn = computed(() => {
  const lastIndex = visibleTimeline.value.length - 1
  return (
    lastIndex >= 0 &&
    visibleTimeline.value[lastIndex]?.type === 'agent-turn'
  )
})

const trailingActivityLabel = computed(() => {
  if (!activityLabel.value || activityOnLastAgentTurn.value) {
    return null
  }
  return activityLabel.value
})

const agentTurnActivityLabel = (index: number): string | null => {
  if (!activityLabel.value || !activityOnLastAgentTurn.value) {
    return null
  }
  if (index !== lastVisibleAgentTurnIndex.value) {
    return null
  }
  return activityLabel.value
}
const followLiveOutput = async (): Promise<void> => {
  if (!isLive.value && !activityLabel.value && !props.compacting) {
    return
  }
  try {
    await nextTick()
    handleContentChange()
    scrollToEnd({ behavior: 'auto' })
  } catch (error) {
    toast.error('Failed to update chat scroll', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

watch(streamRevision, () => {
  followLiveOutput()
})

watch(activityLabel, () => {
  followLiveOutput()
})

watch(
  () => props.compacting,
  (compacting) => {
    if (compacting) {
      followLiveOutput()
    }
  },
)

watch(
  () => props.status,
  (status) => {
    if (status === 'streaming' || status === 'submitted' || activityLabel.value) {
      followLiveOutput()
    }
  },
)
</script>

<template>
  <MessageScroller class="h-full min-h-0 min-w-0 overflow-hidden">
    <MessageScrollerViewport class="scroll-fade-b overflow-x-hidden">
      <MessageScrollerContent
        class="mx-auto w-full min-w-0 max-w-3xl gap-6 overflow-x-hidden p-4 pb-2"
      >
        <MessageScrollerItem
          v-for="(item, index) in visibleTimeline"
          :key="timelineItemId(item, index)"
          :message-id="timelineItemId(item, index)"
          :scroll-anchor="isLastItem(index) && !trailingActivityLabel && !compacting"
          class="min-w-0 max-w-full"
        >
          <ChatMessageTurn
            v-if="item.type === 'user'"
            :message="item.message"
            :editable="!readOnly && !isLive"
          />
          <ChatCompactionMarker
            v-else-if="item.type === 'compaction'"
          />
          <ChatSubAgentTurn
            v-else-if="item.type === 'subagent'"
            :subagent="item"
            @stop-subagent="emit('stopSubagent', $event)"
          />
          <ChatAgentTurn
            v-else-if="item.type === 'agent-turn'"
            :turn="item.turn"
            :status="isLastItem(index) ? status : 'ready'"
            :activity-label="agentTurnActivityLabel(index)"
            :subagents-by-tool-call-id="subagentsByToolCallId"
            :subagents-by-id="subagentsById"
            :restore-enabled="!readOnly && !isLive"
            @retry="emit('retry')"
            @restore-files="emit('restoreFiles', item.turn.id)"
            @stop-subagent="emit('stopSubagent', $event)"
          />
        </MessageScrollerItem>
        <MessageScrollerItem
          v-if="trailingActivityLabel"
          message-id="live-activity"
          :scroll-anchor="true"
          class="min-w-0 max-w-full"
        >
          <AiElementsShimmerShimmer
            v-if="trailingActivityLabel"
            :duration="1.5"
            as="p"
            class="text-sm"
          >
            {{ trailingActivityLabel }}
          </AiElementsShimmerShimmer>
        </MessageScrollerItem>
        <ChatCompactionMarker
          v-if="compacting"
          pending
        />
        <ChatQuestionCard
          v-if="!readOnly && pendingQuestion"
          :question="pendingQuestion"
          @submit="(toolCallId, answer) => emit('submitAnswer', toolCallId, answer)"
        />
        <ChatMcpAuthCard
          v-else-if="!readOnly && activeMcpAuth"
          :auth="activeMcpAuth"
          :personal-mcp="personalMcp ?? { servers: {} }"
          :project-mcp="projectMcp ?? { servers: {} }"
          @authenticate="(toolCallId) => emit('authenticateMcp', toolCallId)"
          @skip="(toolCallId) => emit('skipMcpAuth', toolCallId)"
          @open-settings="(serverId) => emit('openMcpSettings', serverId)"
          @secrets-saved="(toolCallId, serverId) => emit('secretsSavedMcp', toolCallId, serverId)"
        />
      </MessageScrollerContent>
    </MessageScrollerViewport>
  </MessageScroller>
</template>
