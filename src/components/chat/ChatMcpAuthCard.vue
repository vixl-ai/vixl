<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { McpConfig, McpServerConfig } from '@/types/vixl/mcp-config'
import { Button } from '@/components/shadcn/ui/button'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'
import ChatMcpSecretsForm from '@/components/chat/ChatMcpSecretsForm.vue'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'

const props = defineProps<{
  auth: PendingMcpAuthView
  personalMcp: McpConfig
  projectMcp: McpConfig
}>()

const emit = defineEmits<{
  authenticate: [toolCallId: string]
  skip: [toolCallId: string]
  openSettings: [serverId: string]
  secretsSaved: [toolCallId: string, serverId: string]
}>()

const secretsSavedOnce = ref(false)

const serverConfig = computed((): McpServerConfig | null => {
  const effective = listEffectiveMcpServers(props.personalMcp, props.projectMcp)
  return effective.find((item) => item.id === props.auth.serverId)?.config ?? null
})

const mcpConfig = computed((): McpConfig => {
  const effective = listEffectiveMcpServers(props.personalMcp, props.projectMcp)
  const server = effective.find((item) => item.id === props.auth.serverId)
  if (server?.scope === 'project') {
    return props.projectMcp
  }
  return props.personalMcp
})

const handleAuthenticate = (): void => {
  try {
    emit('authenticate', props.auth.toolCallId)
  } catch (error) {
    toast.error('Failed to start authentication', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleSkip = (): void => {
  try {
    emit('skip', props.auth.toolCallId)
  } catch (error) {
    toast.error('Failed to skip authentication', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleOpenSettings = (): void => {
  try {
    emit('openSettings', props.auth.serverId)
  } catch (error) {
    toast.error('Failed to open settings', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleSecretsSaved = (): void => {
  secretsSavedOnce.value = true
  emit('secretsSaved', props.auth.toolCallId, props.auth.serverId)
}
</script>

<template>
  <div class="w-full space-y-3">
    <Marker
      variant="border"
      class="w-full"
    >
      <MarkerContent>
        Waiting for MCP authentication
      </MarkerContent>
    </Marker>
    <div class="space-y-1">
      <p class="text-sm font-medium text-foreground">
        {{ auth.title }}
      </p>
      <p class="flex items-center gap-2 font-mono text-xs text-muted-foreground">
        <McpServerIcon :server-id="auth.serverId" />
        <span>
          {{ auth.serverId }}
          <span v-if="auth.subagentLabel">
            ({{ auth.subagentLabel }})
          </span>
        </span>
      </p>
      <p
        v-if="auth.detail"
        class="text-sm text-muted-foreground"
      >
        {{ auth.detail }}
      </p>
    </div>

    <ChatMcpSecretsForm
      v-if="auth.kind === 'inputs' && serverConfig"
      :server-id="auth.serverId"
      :server-config="serverConfig"
      :mcp-config="mcpConfig"
      @saved="handleSecretsSaved"
    />

    <div class="flex flex-wrap gap-2">
      <Button
        size="sm"
        @click="handleAuthenticate"
      >
        {{ auth.kind === 'inputs' ? (secretsSavedOnce ? 'Continue' : 'Authenticate') : 'Authenticate' }}
      </Button>
      <Button
        size="sm"
        variant="outline"
        @click="handleSkip"
      >
        Skip
      </Button>
      <Button
        size="sm"
        variant="ghost"
        @click="handleOpenSettings"
      >
        Open in Settings
      </Button>
    </div>
  </div>
</template>
