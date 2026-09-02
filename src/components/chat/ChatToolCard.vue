<script setup lang="ts">
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { ref } from 'vue'
import ChatApprovalActions from '@/components/chat/ChatApprovalActions.vue'
import ChatInlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import { isNetworkSandboxApproval } from '@/components/chat/chat-tool-card'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ChevronRightIcon, WifiIcon } from '@lucide/vue'

const NETWORK_TOOLTIP = 'This command uses network in the sandbox'

defineProps<{
  approval: PendingApprovalView
  subagentLabel?: string
}>()

const emit = defineEmits<{
  resolve: [resolution: ApprovalResolution]
}>()

const open = ref(false)
</script>

<template>
  <Collapsible v-model:open="open" class="w-full">
    <div class="flex w-full min-w-0 items-center gap-2">
      <CollapsibleTrigger
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-sm transition-colors hover:text-foreground"
      >
        <ChevronRightIcon
          class="size-3.5 shrink-0 transition-transform"
          :class="open ? 'rotate-90' : ''"
        />
        <McpServerIcon
          v-if="approval.kind === 'mcp' && approval.serverId"
          :server-id="approval.serverId"
        />
        <span class="min-w-0 truncate">{{ approval.title }}</span>
        <TooltipProvider
          v-if="isNetworkSandboxApproval(approval.detail, approval.needsNetwork)"
        >
          <Tooltip>
            <TooltipTrigger as-child>
              <span
                class="inline-flex shrink-0"
                tabindex="0"
                :aria-label="NETWORK_TOOLTIP"
                @click.stop
              >
                <WifiIcon class="size-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent class="z-60">
              {{ NETWORK_TOOLTIP }}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span
          v-if="subagentLabel"
          class="shrink-0 text-xs text-muted-foreground"
        >
          {{ subagentLabel }}
        </span>
      </CollapsibleTrigger>
      <ChatApprovalActions
        :approval="approval"
        @resolve="emit('resolve', $event)"
      />
    </div>
    <CollapsibleContent class="space-y-2 px-2 py-2">
      <p
        v-if="approval.detail"
        class="text-sm text-muted-foreground"
      >
        {{ approval.detail }}
      </p>

      <div
        v-if="approval.kind === 'fs' && approval.diff && approval.diff.length > 0"
        class="space-y-1"
      >
        <ChatInlineFileDiff
          v-for="diff in approval.diff"
          :key="diff.path"
          :diff="diff"
          :show-path="approval.diff.length > 1"
        />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
