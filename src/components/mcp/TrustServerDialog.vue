<script setup lang="ts">
import { Button } from '@/components/shadcn/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import type { McpTrustScope } from '@/types/harness/permission'

const props = defineProps<{
  open: boolean
  serverId: string | null
  saving: boolean
  showWorkspace?: boolean
  scopeKey?: string | null
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  choice: [scope: McpTrustScope]
}>()

const config = useVixlConfig()

const workspaceAvailable = computed(
  () => props.showWorkspace ?? Boolean(config.activeRootPath.value),
)

const handleOpenChange = (open: boolean): void => {
  emit('update:open', open)
}

const handleChoice = (scope: McpTrustScope): void => {
  emit('choice', scope)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Trust MCP server?</DialogTitle>
      </DialogHeader>
      <div class="space-y-3 text-sm text-muted-foreground">
        <p>
          <span class="inline-flex items-center gap-2 font-mono font-medium text-foreground">
            <ServerIcon
              v-if="serverId"
              :server-id="serverId"
              :scope-key="scopeKey"
            />
            {{ serverId }}
          </span>
          is an MCP server that can execute code on your machine (for example via npx or uvx).
          Choose how much you trust this exact command or URL.
        </p>
        <p class="text-xs">
          Untrusted servers cannot be started or called by agents. Changing the command, args, or
          URL requires trust again.
        </p>
      </div>
      <DialogFooter class="flex-col gap-2 sm:flex-col">
        <Button class="w-full" :disabled="saving" @click="handleChoice('session')">
          This session
        </Button>
        <Button
          v-if="workspaceAvailable"
          variant="outline"
          class="w-full"
          :disabled="saving"
          @click="handleChoice('workspace')"
        >
          This workspace
        </Button>
        <Button
          variant="outline"
          class="w-full"
          :disabled="saving"
          @click="handleChoice('always')"
        >
          Always
        </Button>
        <Button
          variant="ghost"
          class="w-full text-destructive hover:text-destructive"
          :disabled="saving"
          @click="handleChoice('never')"
        >
          Never
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
