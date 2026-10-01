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
import ChatPendingApprovals from '@/components/chat/ChatPendingApprovals.vue'
import ChatSubagentStack from '@/components/chat/ChatSubagentStack.vue'
import ChatSubagentUsage from '@/components/chat/ChatSubagentUsage.vue'
import ChatStackPillBar from '@/components/chat/ChatStackPillBar.vue'
import useAgentThreadView from '@/composables/agent-thread-view'
import type { ChatStackId } from '@/types/chat/chat-stack-id'

const {
  workbench,
  contextActions,
  mcpPersonalConfig,
  mcpProjectConfig,
  threadReady,
  projectSlug,
  chatId,
  subagentId,
  isSubagentView,
  threadKey,
  harnessStatus,
  harnessPendingApprovals,
  harnessPendingMcpAuth,
  queuedMessages,
  isWaitingOnBackground,
  runningSubagents,
  chatPromptInputRef,
  pendingQuestion,
  compacting,
  continuableTurnId,
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
  handleOpenSubagent,
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
  handleContinue,
  handlePermissionLevelChange,
} = useAgentThreadView()

const { visiblePills, openStack, toggleStack } = useChatStackPills({
  subagents: computed(() => runningSubagents.value.length),
  approvals: computed(() => harnessPendingApprovals.value.length),
  terminals: computed(() => runningShells.value.length),
  queue: computed(() => queuedMessages.value.length),
  todos: computed(() => todos.value.length),
  resetKey: threadKey,
})

const pills = computed(() => {
  const counts: Record<ChatStackId, number> = {
    subagents: runningSubagents.value.length,
    approvals: harnessPendingApprovals.value.length,
    terminals: runningShells.value.length,
    queue: queuedMessages.value.length,
    todos: todos.value.length,
  }
  const todosCompleted = todos.value.filter(
    (todo) => todo.status === 'completed',
  ).length
  return visiblePills.value.map((id) => {
    const n = counts[id]
    if (id === 'subagents') {
      return { id, label: n === 1 ? '1 agent' : `${n} agents` }
    }
    if (id === 'approvals') {
      return { id, label: n === 1 ? '1 approval' : `${n} approvals` }
    }
    if (id === 'terminals') {
      return { id, label: n === 1 ? '1 terminal' : `${n} terminals` }
    }
    if (id === 'queue') {
      return { id, label: `${n} queued` }
    }
    return { id, label: `Tasks ${todosCompleted}/${n}` }
  })
})
</script>

<template>
  <div class="relative flex h-full min-h-0 flex-col">
    <div class="relative flex min-h-0 flex-1 flex-col">
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
          :continuable-turn-id="continuableTurnId"
          @resolve-approval="handleResolveApproval"
          @submit-answer="handleSubmitAnswer"
          @authenticate-mcp="handleAuthenticateMcp"
          @skip-mcp-auth="handleSkipMcpAuth"
          @open-mcp-settings="handleOpenMcpSettings"
          @secrets-saved-mcp="(toolCallId) => handleSecretsSavedMcp(toolCallId)"
          @retry="handleRetry"
          @continue="handleContinue"
          @restore-files="handleRestoreFiles"
          @stop-subagent="handleStopSubagent"
        />
      </ChatChatPanelContextMenu>
    </div>
    <ChatFilePolicyDialog
      v-model:open="filePolicyOpen"
      :title="filePolicyTitle"
      :changes="filePolicyChanges"
      :emphasize-revert="filePolicyEmphasizeRevert"
      @keep="handleFilePolicyKeep"
      @revert="handleFilePolicyRevert"
    />
    <div
      class="shrink-0 px-4 pb-4 pt-2"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col">
        <template v-if="!isSubagentView">
          <div
            v-if="openStack"
            class="mb-2 w-full rounded-lg border border-border/50 bg-card p-2"
          >
            <ChatPendingApprovals
              v-if="openStack === 'approvals'"
              :approvals="harnessPendingApprovals"
              @resolve="handleResolveApproval"
            />
            <ChatTodoTimeline
              v-else-if="openStack === 'todos'"
              :todos="todos"
            />
            <RunningTerminalsPanel
              v-else-if="openStack === 'terminals'"
              :shells="runningShells"
              @open-shell="handleOpenShell"
              @stop-shell="handleKillShell"
            />
            <ChatMessageQueue
              v-else-if="openStack === 'queue'"
              :items="queuedMessages"
              @edit="handleQueueEdit"
              @force="handleQueueForce"
              @remove="handleQueueRemove"
            />
            <ChatSubagentStack
              v-else-if="openStack === 'subagents'"
              :subagents="runningSubagents"
              @open="handleOpenSubagent"
              @stop="handleStopSubagent"
            />
          </div>
          <ChatStackPillBar
            :pills="pills"
            :open-stack="openStack"
            class="mb-2 w-full"
            @toggle="toggleStack"
          />
        </template>
        <ChatSubagentUsage
          v-if="
            isSubagentView &&
            harnessStatus !== 'streaming' &&
            harnessStatus !== 'submitted'
          "
          :subagent-id="subagentId"
          class="mb-2"
        />
        <ChatPromptInput
          ref="chatPromptInputRef"
          :key="threadKey"
          :status="harnessStatus"
          :disabled="!threadReady"
          :permission-level="activePermissionLevel"
          :waiting-on-background="isSubagentView ? false : isWaitingOnBackground"
          :allow-submit-while-busy="isSubagentView"
          :hide-model="isSubagentView"
          :hide-mode="isSubagentView"
          :hide-stop="isSubagentView"
          @submit="handleSubmit"
          @submit-edit="handleSubmitEdit"
          @stop="handleStop"
          @update:permission-level="handlePermissionLevelChange"
        />
      </div>
    </div>
  </div>
</template>
