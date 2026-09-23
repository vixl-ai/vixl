<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import type { ChatTimelineItem, SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import type { ToolRun } from '@/types/harness/tool-run'
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
import {
  aggregateChatFileDiffs,
  collectMutationsAfterUserMessage,
} from '@/services/harness/restore-file-checkpoints'
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

type SubagentMaps = {
  byToolCallId: Map<string, SubagentTimelineItem>
  byId: Map<string, SubagentTimelineItem>
}

type CompletedFileToolMark = {
  toolCallId: string
  diffs: NonNullable<ToolRun['diffs']>
}

type LastTurnRestoreBoundary = {
  lastTurnIndex: number
  userMessageId: string
}

const collectSubagentItems = (timeline: ChatTimelineItem[]): SubagentTimelineItem[] => {
  const items: SubagentTimelineItem[] = []
  for (const item of timeline) {
    if (item.type === 'subagent') {
      items.push(item)
    }
  }
  return items
}

const sameSubagentItems = (
  left: SubagentTimelineItem[],
  right: SubagentTimelineItem[],
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

const buildSubagentMaps = (items: SubagentTimelineItem[]): SubagentMaps => {
  const byToolCallId = new Map<string, SubagentTimelineItem>()
  const byId = new Map<string, SubagentTimelineItem>()
  for (const item of items) {
    byId.set(item.subagentId, item)
    if (item.toolCallId) {
      byToolCallId.set(item.toolCallId, item)
    }
  }
  return { byToolCallId, byId }
}

const collectCompletedFileTools = (
  timeline: ChatTimelineItem[],
): CompletedFileToolMark[] => {
  const marks: CompletedFileToolMark[] = []
  const takeTools = (tools: ToolRun[]): void => {
    for (const tool of tools) {
      if (tool.status === 'done' && tool.diffs && tool.diffs.length > 0) {
        marks.push({ toolCallId: tool.toolCallId, diffs: tool.diffs })
      }
    }
  }
  for (const item of timeline) {
    if (item.type === 'agent-turn') {
      for (const step of item.turn.steps) {
        takeTools(step.tools)
      }
      continue
    }
    if (item.type === 'subagent') {
      takeTools(item.tools)
    }
  }
  return marks
}

const sameCompletedFileTools = (
  left: CompletedFileToolMark[],
  right: CompletedFileToolMark[],
): boolean => {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftMark = left[index]
    const rightMark = right[index]
    if (
      leftMark?.toolCallId !== rightMark?.toolCallId ||
      leftMark?.diffs !== rightMark?.diffs
    ) {
      return false
    }
  }
  return true
}

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
    compacting: props.compacting === true,
  }),
)

const activeMcpAuth = computed(() => {
  if (props.pendingQuestion) {
    return null
  }
  const queue = props.pendingMcpAuth ?? []
  return queue[0] ?? null
})

const subagentRevision = computed(() =>
  props.timeline
    .filter((item): item is SubagentTimelineItem => item.type === 'subagent')
    .map((item) => `${item.subagentId}:${item.status}:${item.summary?.length ?? 0}`)
    .join('|'),
)

let cachedSubagentItems: SubagentTimelineItem[] = []
let cachedSubagentMaps: SubagentMaps = {
  byToolCallId: new Map(),
  byId: new Map(),
}

const subagentMaps = computed((): SubagentMaps => {
  const items = collectSubagentItems(props.timeline)
  if (sameSubagentItems(items, cachedSubagentItems)) {
    return cachedSubagentMaps
  }
  cachedSubagentItems = items
  cachedSubagentMaps = buildSubagentMaps(items)
  return cachedSubagentMaps
})

const subagentsByToolCallId = computed(() => subagentMaps.value.byToolCallId)

const subagentsById = computed(() => subagentMaps.value.byId)

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

const lastAgentTurnIndex = computed(() => {
  for (let index = props.timeline.length - 1; index >= 0; index -= 1) {
    if (props.timeline[index]?.type === 'agent-turn') {
      return index
    }
  }
  return -1
})

let cachedCompletedFileTools: CompletedFileToolMark[] = []
let cachedFileToolsForChanges: CompletedFileToolMark[] | null = null
let cachedChatFileChanges: AggregatedTurnFileChange[] = []
let cachedRestoreBoundary: LastTurnRestoreBoundary | null = null
let cachedRestoreFileTools: CompletedFileToolMark[] | null = null
let cachedLastTurnRestoreChanges: AggregatedTurnFileChange[] | undefined
let cachedRestoreBoundaryObj: LastTurnRestoreBoundary | null = null

const completedFileTools = computed((): CompletedFileToolMark[] => {
  const marks = collectCompletedFileTools(props.timeline)
  if (sameCompletedFileTools(marks, cachedCompletedFileTools)) {
    return cachedCompletedFileTools
  }
  cachedCompletedFileTools = marks
  return cachedCompletedFileTools
})

const chatFileChanges = computed(() => {
  const fileTools = completedFileTools.value
  if (fileTools === cachedFileToolsForChanges) {
    return cachedChatFileChanges
  }
  const changes = aggregateChatFileDiffs(props.timeline)
  cachedFileToolsForChanges = fileTools
  cachedChatFileChanges = changes
  return cachedChatFileChanges
})

const lastTurnRestoreBoundary = computed((): LastTurnRestoreBoundary | null => {
  const lastTurnIndex = lastAgentTurnIndex.value
  if (lastTurnIndex < 0) {
    cachedRestoreBoundaryObj = null
    return null
  }
  let userMessageId: string | null = null
  for (let index = lastTurnIndex - 1; index >= 0; index -= 1) {
    const item = props.timeline[index]
    if (item?.type === 'user') {
      userMessageId = item.message.id
      break
    }
  }
  if (!userMessageId) {
    cachedRestoreBoundaryObj = null
    return null
  }
  if (
    cachedRestoreBoundaryObj &&
    cachedRestoreBoundaryObj.lastTurnIndex === lastTurnIndex &&
    cachedRestoreBoundaryObj.userMessageId === userMessageId
  ) {
    return cachedRestoreBoundaryObj
  }
  cachedRestoreBoundaryObj = { lastTurnIndex, userMessageId }
  return cachedRestoreBoundaryObj
})

const lastTurnRestoreChanges = computed((): AggregatedTurnFileChange[] | undefined => {
  const boundary = lastTurnRestoreBoundary.value
  const fileTools = completedFileTools.value
  if (!boundary) {
    return undefined
  }
  if (cachedRestoreBoundary === boundary && cachedRestoreFileTools === fileTools) {
    return cachedLastTurnRestoreChanges
  }
  const changes = collectMutationsAfterUserMessage(props.timeline, boundary.userMessageId)
  cachedRestoreBoundary = boundary
  cachedRestoreFileTools = fileTools
  cachedLastTurnRestoreChanges = changes
  return cachedLastTurnRestoreChanges
})

const lastTurnCanRestore = computed(() => (lastTurnRestoreChanges.value?.length ?? 0) > 0)

const hasUserMessageAfterLastTurn = computed(() => {
  const lastTurnIndex = lastAgentTurnIndex.value
  if (lastTurnIndex < 0) {
    return false
  }
  for (let index = lastTurnIndex + 1; index < props.timeline.length; index += 1) {
    if (props.timeline[index]?.type === 'user') {
      return true
    }
  }
  return false
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

let followLiveFrame: number | null = null

const cancelFollowLiveOutput = (): void => {
  if (followLiveFrame === null) {
    return
  }
  window.cancelAnimationFrame(followLiveFrame)
  followLiveFrame = null
}

const scheduleFollowLiveOutput = (): void => {
  if (followLiveFrame !== null) {
    return
  }
  followLiveFrame = window.requestAnimationFrame(() => {
    followLiveFrame = null
    void followLiveOutput()
  })
}

watch(streamRevision, () => {
  scheduleFollowLiveOutput()
})

onBeforeUnmount(() => {
  cancelFollowLiveOutput()
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
            :restore-enabled="!readOnly && !isLive && (index !== lastVisibleAgentTurnIndex || lastTurnCanRestore)"
            :chat-file-changes="index === lastVisibleAgentTurnIndex ? chatFileChanges : null"
            :restore-changes="index === lastVisibleAgentTurnIndex ? lastTurnRestoreChanges : undefined"
            :restore-discards-latest-message="index === lastVisibleAgentTurnIndex ? hasUserMessageAfterLastTurn : undefined"
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
