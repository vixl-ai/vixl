<script setup lang="ts">
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'

defineProps<{
  approvals: PendingApprovalView[]
}>()

const emit = defineEmits<{
  resolve: [toolCallId: string, resolution: ApprovalResolution]
}>()
</script>

<template>
  <div class="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-border/50 bg-card p-2">
    <ChatToolCard
      v-for="approval in approvals"
      :key="approval.toolCallId"
      :approval="approval"
      :subagent-label="approval.subagentLabel"
      @resolve="(r: ApprovalResolution) => emit('resolve', approval.toolCallId, r)"
    />
  </div>
</template>
