<script setup lang="ts">
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import ChatApprovalActions from '@/components/chat/ChatApprovalActions.vue'
import ChatInlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import { Badge } from '@/components/shadcn/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'

defineProps<{
  approval: PendingApprovalView
}>()

const emit = defineEmits<{
  resolve: [resolution: ApprovalResolution]
}>()
</script>

<template>
  <Collapsible default-open class="w-full">
    <div class="flex w-full min-w-0 items-center gap-2">
      <CollapsibleTrigger as-child>
        <Marker variant="border" class="min-w-0 flex-1 cursor-pointer">
          <MarkerContent class="gap-2">
            <Badge variant="outline" class="shrink-0 text-xs font-normal capitalize">
              {{ approval.kind }}
            </Badge>
            <McpServerIcon
              v-if="approval.kind === 'mcp' && approval.serverId"
              :server-id="approval.serverId"
            />
            <span class="min-w-0 truncate">{{ approval.title }}</span>
          </MarkerContent>
        </Marker>
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
        />
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
