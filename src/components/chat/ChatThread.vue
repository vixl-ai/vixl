<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { PendingQuestionState } from '@/types/chat/pending-question'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { McpConfig } from '@/types/vixl/mcp-config'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import ChatThreadContent from '@/components/chat/ChatThreadContent.vue'
import { MessageScrollerProvider } from '@/components/shadcn/ui/message-scroller'

defineProps<{
  timeline: ChatTimelineItem[]
  status?: ChatStatus
  pendingApprovals: PendingApprovalView[]
  pendingQuestion?: PendingQuestionState | null
  pendingMcpAuth?: PendingMcpAuthView[]
  personalMcp?: McpConfig
  projectMcp?: McpConfig
  readOnly?: boolean
}>()

defineEmits<{
  submitAnswer: [toolCallId: string, answer: string]
  authenticateMcp: [toolCallId: string]
  skipMcpAuth: [toolCallId: string]
  openMcpSettings: [serverId: string]
  secretsSavedMcp: [toolCallId: string, serverId: string]
  retry: []
  restoreFiles: [turnId: string]
  stopSubagent: [subagentId: string]
}>()
</script>

<template>
  <MessageScrollerProvider
    :auto-scroll="true"
    default-scroll-position="end"
  >
    <ChatThreadContent
      :timeline="timeline"
      :status="status"
      :pending-approvals="pendingApprovals"
      :pending-question="pendingQuestion"
      :pending-mcp-auth="pendingMcpAuth"
      :personal-mcp="personalMcp"
      :project-mcp="projectMcp"
      :read-only="readOnly"
      @submit-answer="(toolCallId, answer) => $emit('submitAnswer', toolCallId, answer)"
      @authenticate-mcp="(toolCallId) => $emit('authenticateMcp', toolCallId)"
      @skip-mcp-auth="(toolCallId) => $emit('skipMcpAuth', toolCallId)"
      @open-mcp-settings="(serverId) => $emit('openMcpSettings', serverId)"
      @secrets-saved-mcp="(toolCallId, serverId) => $emit('secretsSavedMcp', toolCallId, serverId)"
      @retry="$emit('retry')"
      @restore-files="$emit('restoreFiles', $event)"
      @stop-subagent="$emit('stopSubagent', $event)"
    />
  </MessageScrollerProvider>
</template>
