<script setup lang="ts">
import {
  ChevronDownIcon,
  ServerIcon,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/shadcn/ui/popover'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import connectionKey from '@/services/mcp/connection-key'
import useChatMcpServerPicker from '@/composables/mcp-servers/use-chat-mcp-server-picker'

const props = defineProps<{
  projectRoot: string | null
  members?: HarnessWorkspaceMember[]
}>()

const {
  menuOpen,
  searchQuery,
  pickerServers,
  filteredServers,
  connectedCount,
  hasAuthRequired,
  trustPending,
  trustSaving,
  trustRoot,
  scopeForServer,
  refreshOnOpen,
  handleOpenInSettings,
  handleToggleChange,
  handleLogin,
  handleTrustChoice,
  handleTrustDialogOpen,
} = useChatMcpServerPicker({
  projectRoot: () => props.projectRoot,
  members: () => props.members,
})
</script>

<template>
  <Popover :open="menuOpen" @update:open="refreshOnOpen">
    <PopoverTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 gap-1.5 px-2 text-xs"
        :class="
          hasAuthRequired
            ? 'text-amber-600 dark:text-amber-400'
            : 'text-muted-foreground'
        "
        :title="`${connectedCount} of ${pickerServers.length} MCP servers connected`"
        aria-label="MCP servers"
      >
        <ServerIcon class="size-3.5 shrink-0" />
        <span class="max-w-32 min-w-0 truncate @max-[22rem]/composer:hidden">
          MCP
          <template v-if="pickerServers.length > 0">
            ({{ connectedCount }}/{{ pickerServers.length }})
          </template>
        </span>
        <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" class="w-80 p-0">
      <div class="border-b border-border/50 p-2">
        <Input
          v-model="searchQuery"
          placeholder="Search MCP servers…"
          class="h-8"
        />
      </div>
      <div class="max-h-60 overflow-y-auto p-1">
        <p
          v-if="filteredServers.length === 0"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          {{
            searchQuery.trim()
              ? 'No servers match your search.'
              : 'No MCP servers configured.'
          }}
        </p>
        <ChatMcpServerPickerItem
          v-for="server in filteredServers"
          :key="connectionKey(scopeForServer(server), server.id)"
          :server="server"
          :scope-key="scopeForServer(server)"
          @login="handleLogin(server)"
          @settings="handleOpenInSettings(server)"
          @toggle="(checked) => handleToggleChange(server, checked)"
        />
      </div>
    </PopoverContent>
  </Popover>
  <TrustServerDialog
    :open="trustPending !== null"
    :server-id="trustPending?.serverId ?? null"
    :scope-key="trustPending?.scopeKey"
    :saving="trustSaving"
    :show-workspace="trustRoot !== null || props.projectRoot !== null"
    @update:open="handleTrustDialogOpen"
    @choice="handleTrustChoice"
  />
</template>
