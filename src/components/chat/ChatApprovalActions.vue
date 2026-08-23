<script setup lang="ts">
import {
  BanIcon,
  CheckIcon,
  ClockIcon,
  FolderIcon,
  InfinityIcon,
  UnlockIcon,
  WifiIcon,
  XIcon,
} from '@lucide/vue'
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { PermissionScope } from '@/types/harness/permission'
import {
  approvalActionSpecs,
  type ApprovalActionKey,
} from '@/components/chat/chat-tool-card'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    approval: PendingApprovalView
    tone?: 'chat' | 'terminal'
  }>(),
  { tone: 'chat' },
)

const emit = defineEmits<{
  resolve: [resolution: ApprovalResolution]
}>()

const actions = computed(() =>
  approvalActionSpecs({
    allowedScopes: props.approval.allowedScopes,
    unsandboxed: props.approval.unsandboxed,
    detail: props.approval.detail,
  }),
)

const iconFor = (key: ApprovalActionKey) => {
  if (key === 'once' && props.approval.unsandboxed) {
    return UnlockIcon
  }
  if (key === 'once' && props.approval.detail?.includes('(network denied)')) {
    return WifiIcon
  }
  if (key === 'once') {
    return CheckIcon
  }
  if (key === 'session') {
    return ClockIcon
  }
  if (key === 'workspace') {
    return FolderIcon
  }
  if (key === 'always') {
    return InfinityIcon
  }
  if (key === 'never') {
    return BanIcon
  }
  return XIcon
}

const actionClass = (key: ApprovalActionKey): string => {
  if (props.tone !== 'terminal') {
    if (key === 'never' || key === 'deny') {
      return 'size-7 shrink-0 text-destructive hover:text-destructive'
    }
    return 'size-7 shrink-0 text-muted-foreground hover:text-foreground'
  }
  if (key === 'once') {
    return 'size-7 shrink-0 text-emerald-400 hover:bg-zinc-800 hover:!text-emerald-300'
  }
  if (key === 'session') {
    return 'size-7 shrink-0 text-amber-400 hover:bg-zinc-800 hover:!text-amber-300'
  }
  if (key === 'deny' || key === 'never') {
    return 'size-7 shrink-0 text-red-400 hover:bg-zinc-800 hover:!text-red-300'
  }
  return 'size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100'
}

const handleAction = (key: ApprovalActionKey): void => {
  if (key === 'deny') {
    emit('resolve', { approved: false, scope: 'once' })
    return
  }
  if (key === 'never') {
    emit('resolve', { approved: false, scope: 'never' })
    return
  }
  emit('resolve', {
    approved: true,
    scope: key as Exclude<PermissionScope, 'never'>,
  })
}
</script>

<template>
  <div class="flex shrink-0 items-center gap-0" @click.stop>
    <TooltipProvider
      v-for="action in actions"
      :key="action.key"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            :class="actionClass(action.key)"
            :aria-label="action.tooltip"
            @click.stop="handleAction(action.key)"
          >
            <component :is="iconFor(action.key)" class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent class="z-60">
          {{ action.tooltip }}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  </div>
</template>
