<script setup lang="ts">
import { computed } from 'vue'
import type { ChatStatus } from 'ai'
import { RotateCcwIcon } from '@lucide/vue'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import type { ToolRun } from '@/types/harness/tool-run'
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import AiElementsChainOfThoughtChainOfThought from '@/components/ai-elements/chain-of-thought/ChainOfThought.vue'
import AiElementsChainOfThoughtChainOfThoughtContent from '@/components/ai-elements/chain-of-thought/ChainOfThoughtContent.vue'
import AiElementsChainOfThoughtChainOfThoughtHeader from '@/components/ai-elements/chain-of-thought/ChainOfThoughtHeader.vue'
import AiElementsMessageMessage from '@/components/ai-elements/message/Message.vue'
import AiElementsMessageMessageResponse from '@/components/ai-elements/message/MessageResponse.vue'
import AiElementsReasoningReasoning from '@/components/ai-elements/reasoning/Reasoning.vue'
import AiElementsReasoningReasoningContent from '@/components/ai-elements/reasoning/ReasoningContent.vue'
import AiElementsReasoningReasoningTrigger from '@/components/ai-elements/reasoning/ReasoningTrigger.vue'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import ChatAgentTurnUsage from '@/components/chat/ChatAgentTurnUsage.vue'
import ChatSubAgentTurn from '@/components/chat/SubAgentTurn.vue'
import ChatToolRun from '@/components/chat/ChatToolRun.vue'
import ChatTurnFilesChanged from '@/components/chat/ChatTurnFilesChanged.vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/shadcn/ui/alert'
import resolveSpawnSubagent from '@/utils/resolve-spawn-subagent'
import segmentStepTools from '@/utils/segment-step-tools'
import { aggregateTurnFileDiffs } from '@/services/harness/restore-file-checkpoints'

const props = defineProps<{
  turn: AgentTurn
  status?: ChatStatus
  activityLabel?: string | null
  subagentsByToolCallId?: Map<string, SubagentTimelineItem>
  subagentsById?: Map<string, SubagentTimelineItem>
  restoreEnabled?: boolean
  pendingApprovals?: Map<string, PendingApprovalView>
}>()

const emit = defineEmits<{
  retry: []
  restoreFiles: []
  stopSubagent: [subagentId: string]
  resolveApproval: [toolCallId: string, resolution: ApprovalResolution]
}>()

const isStreaming = computed(
  () => props.status === 'streaming' || props.status === 'submitted',
)

const showActivity = computed(
  () => typeof props.activityLabel === 'string' && props.activityLabel.length > 0,
)

const fileChanges = computed(() => aggregateTurnFileDiffs(props.turn))

const showFilesChanged = computed(
  () => !isStreaming.value && fileChanges.value.length > 0,
)

const stepEntries = computed(() =>
  props.turn.steps.map((step, index) => ({
    step,
    index,
    segments: segmentStepTools(step.tools),
    hasSpawnSubagent: step.tools.some((tool) => tool.name === 'spawn_subagent'),
  })),
)

const isStepStreaming = (index: number): boolean => {
  if (!isStreaming.value) {
    return false
  }
  return index === props.turn.steps.length - 1
}

const toolHeaderLabel = (count: number, index: number): string => {
  if (isStepStreaming(index)) {
    return `Using ${count} tools`
  }
  return `Used ${count} tools`
}

const approvalFor = (run: ToolRun): PendingApprovalView | undefined =>
  props.pendingApprovals?.get(run.toolCallId)

const resolveSubagent = (run: ToolRun): SubagentTimelineItem =>
  resolveSpawnSubagent(
    run,
    props.subagentsByToolCallId ?? new Map(),
    props.subagentsById ?? new Map(),
  )

const errorTitle = computed(() => {
  const kind = props.turn.error?.kind
  if (kind === 'timeout') {
    return 'Timed out'
  }
  return 'Something went wrong'
})
</script>

<template>
  <div class="flex w-full min-w-0 max-w-full flex-col gap-2">
    <!--
      AI SDK parts order per step: reasoning → text → tools.
      Sub-agents render inline at their tool call site so later
      assistant text stays below them instead of pushing a bottom stack.
    -->
    <template
      v-for="{ step, index, segments, hasSpawnSubagent } in stepEntries"
      :key="step.id"
    >
      <AiElementsReasoningReasoning
        v-if="step.reasoning.trim().length > 0"
        :is-streaming="isStepStreaming(index) && step.text.trim().length === 0 && step.tools.length === 0"
        :default-open="
          (isStepStreaming(index) && step.text.trim().length === 0 && step.tools.length === 0)
          || hasSpawnSubagent
        "
        class="mb-0 w-full max-w-prose"
      >
        <AiElementsReasoningReasoningTrigger />
        <AiElementsReasoningReasoningContent
          :content="step.reasoning"
          class="max-w-prose"
        />
      </AiElementsReasoningReasoning>

      <AiElementsMessageMessage
        v-if="step.text.trim().length > 0"
        from="assistant"
        class="max-w-full"
      >
        <AiElementsMessageMessageResponse
          :content="step.text"
          :streaming="isStepStreaming(index) && step.tools.length === 0"
          class="chat-markdown text-sm"
        />
      </AiElementsMessageMessage>

      <template
        v-for="(segment, segmentIndex) in segments"
        :key="`${step.id}-seg-${segmentIndex}`"
      >
        <ChatSubAgentTurn
          v-if="segment.type === 'subagent'"
          :subagent="resolveSubagent(segment.run)"
          @stop-subagent="emit('stopSubagent', $event)"
        />
        <ChatToolRun
          v-else-if="segment.tools.length === 1"
          :run="segment.tools[0]!"
          :approval="approvalFor(segment.tools[0]!)"
          @resolve-approval="
            (resolution) => emit('resolveApproval', segment.tools[0]!.toolCallId, resolution)
          "
        />
        <AiElementsChainOfThoughtChainOfThought
          v-else
          :is-streaming="isStepStreaming(index)"
          :default-open="isStepStreaming(index)"
          class="w-full max-w-full"
        >
          <AiElementsChainOfThoughtChainOfThoughtHeader>
            <AiElementsShimmerShimmer
              v-if="isStepStreaming(index)"
              :duration="1"
              as="span"
            >
              {{ toolHeaderLabel(segment.tools.length, index) }}
            </AiElementsShimmerShimmer>
            <span v-else>{{ toolHeaderLabel(segment.tools.length, index) }}</span>
          </AiElementsChainOfThoughtChainOfThoughtHeader>
          <AiElementsChainOfThoughtChainOfThoughtContent class="space-y-2">
            <div class="flex flex-col gap-0.5">
              <ChatToolRun
                v-for="tool in segment.tools"
                :key="tool.toolCallId"
                :run="tool"
                :approval="approvalFor(tool)"
                @resolve-approval="
                  (resolution) => emit('resolveApproval', tool.toolCallId, resolution)
                "
              />
            </div>
          </AiElementsChainOfThoughtChainOfThoughtContent>
        </AiElementsChainOfThoughtChainOfThought>
      </template>
    </template>

    <AiElementsMessageMessage
      v-if="turn.text.trim().length > 0"
      from="assistant"
      class="max-w-full"
    >
      <AiElementsMessageMessageResponse
        :content="turn.text"
        :streaming="isStreaming"
        class="chat-markdown text-sm"
      />
    </AiElementsMessageMessage>

    <AiElementsShimmerShimmer
      v-if="showActivity"
      :duration="1.5"
      as="p"
      class="text-sm"
    >
      {{ activityLabel }}
    </AiElementsShimmerShimmer>

    <ChatTurnFilesChanged
      v-if="showFilesChanged"
      :changes="fileChanges"
      :restore-enabled="restoreEnabled === true"
      @restore="emit('restoreFiles')"
    />

    <ChatAgentTurnUsage
      v-if="!isStreaming"
      :turn-id="turn.id"
    />

    <Alert
      v-if="turn.error && turn.error.kind !== 'aborted'"
      variant="destructive"
      class="max-w-xl"
    >
      <AlertTitle>{{ errorTitle }}</AlertTitle>
      <AlertDescription class="flex flex-col gap-3">
        <span>{{ turn.error.message }}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          class="w-fit gap-1.5"
          @click="emit('retry')"
        >
          <RotateCcwIcon class="size-3.5" />
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  </div>
</template>
