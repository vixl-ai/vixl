<script setup lang="ts">
import ChatPromptInput from '@/components/chat/ChatPromptInput.vue'
import ChatMessageQueue from '@/components/chat/ChatMessageQueue.vue'
import ChatThread from '@/components/chat/ChatThread.vue'
import ChatTodoTimeline from '@/components/chat/ChatTodoTimeline.vue'
import ChatFilePolicyDialog from '@/components/chat/ChatFilePolicyDialog.vue'
import RunningTerminalsPanel from '@/components/chat/RunningTerminalsPanel.vue'
import ChatContextUsageBar from '@/components/chat/ContextUsageBar.vue'
import ChatCodegraphStatusChip from '@/components/chat/ChatCodegraphStatusChip.vue'
import ChatChatPanelContextMenu from '@/components/chat/ChatPanelContextMenu.vue'
import useAgentThreadView from '@/composables/agent-thread-view'

const {
  workbench,
  contextActions,
  mcpPersonalConfig,
  mcpProjectConfig,
  threadReady,
  projectSlug,
  chatId,
  isSubagentView,
  threadKey,
  harnessStatus,
  harnessPendingApprovals,
  harnessPendingMcpAuth,
  queuedMessages,
  isWaitingOnBackground,
  chatPromptInputRef,
  pendingQuestion,
  compacting,
  timeline,
  todos,
  runningShells,
  activePermissionLevel,
  filePolicyOpen,
  filePolicyChanges,
  filePolicyTitle,
  filePolicyEmphasizeRevert,
  handleSubmit,
  handleSubmitEdit,
  handleFilePolicyKeep,
  handleFilePolicyRevert,
  handleRestoreFiles,
  handleStop,
  handleStopSubagent,
  handleQueueForce,
  handleQueueRemove,
  handleQueueEdit,
  handleKillShell,
  handleOpenShell,
  handleResolveApproval,
  handleSubmitAnswer,
  handleAuthenticateMcp,
  handleSecretsSavedMcp,
  handleSkipMcpAuth,
  handleOpenMcpSettings,
  handleRetry,
  handlePermissionLevelChange,
} = useAgentThreadView()
</script>

<template>
  <ChatChatPanelContextMenu
    :project-slug="projectSlug"
    :chat-id="chatId"
  >
    <!--
      Always host the ring on the chat column titlebar band. Parent main uses
      pt-(--titlebar-height). z-51 sits above the titlebar drag region; the
      sidebar trigger uses z-52 so it stays clickable when the workbench is closed.
    -->
    <div
      v-if="contextActions.available.value"
      class="pointer-events-none absolute inset-x-0 top-0 z-[51] flex h-(--titlebar-height) -translate-y-full items-center justify-end"
      :class="workbench.rightSidebarOpen.value ? 'pr-2' : 'pr-12'"
      style="--titlebar-height: 40px"
    >
      <div class="pointer-events-auto flex items-center gap-2" data-tauri-drag-region="false">
        <ChatCodegraphStatusChip />
        <ChatContextUsageBar />
      </div>
    </div>
    <ChatThread
      :key="threadKey"
      class="min-h-0 flex-1"
      :timeline="timeline"
      :status="harnessStatus"
      :pending-approvals="isSubagentView ? [] : harnessPendingApprovals"
      :pending-question="isSubagentView ? null : pendingQuestion"
      :pending-mcp-auth="isSubagentView ? [] : harnessPendingMcpAuth"
      :personal-mcp="mcpPersonalConfig"
      :project-mcp="mcpProjectConfig"
      :read-only="isSubagentView"
      :compacting="compacting"
      @resolve-approval="handleResolveApproval"
      @submit-answer="handleSubmitAnswer"
      @authenticate-mcp="handleAuthenticateMcp"
      @skip-mcp-auth="handleSkipMcpAuth"
      @open-mcp-settings="handleOpenMcpSettings"
      @secrets-saved-mcp="(toolCallId) => handleSecretsSavedMcp(toolCallId)"
      @retry="handleRetry"
      @restore-files="handleRestoreFiles"
      @stop-subagent="handleStopSubagent"
    />
    <ChatFilePolicyDialog
      v-model:open="filePolicyOpen"
      :title="filePolicyTitle"
      :changes="filePolicyChanges"
      :emphasize-revert="filePolicyEmphasizeRevert"
      @keep="handleFilePolicyKeep"
      @revert="handleFilePolicyRevert"
    />
    <div
      v-if="!isSubagentView"
      class="shrink-0 px-4 pb-4 pt-2"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col">
        <ChatPendingApprovals
          v-if="harnessPendingApprovals.length > 0"
          :approvals="harnessPendingApprovals"
          class="mb-2 w-full"
          @resolve="handleResolveApproval"
        />
        <ChatTodoTimeline
          v-if="todos.length > 0"
          :todos="todos"
          class="mb-2 w-full"
        />
        <RunningTerminalsPanel
          :shells="runningShells"
          @open-shell="handleOpenShell"
          @stop-shell="handleKillShell"
        />
        <ChatMessageQueue
          v-if="queuedMessages.length > 0"
          :items="queuedMessages"
          class="mb-2 w-full"
          @edit="handleQueueEdit"
          @force="handleQueueForce"
          @remove="handleQueueRemove"
        />
        <ChatPromptInput
          ref="chatPromptInputRef"
          :key="threadKey"
          :status="harnessStatus"
          :disabled="!threadReady"
          :permission-level="activePermissionLevel"
          :waiting-on-background="isWaitingOnBackground"
          @submit="handleSubmit"
          @submit-edit="handleSubmitEdit"
          @stop="handleStop"
          @update:permission-level="handlePermissionLevelChange"
        />
      </div>
    </div>
  </ChatChatPanelContextMenu>
</template>
