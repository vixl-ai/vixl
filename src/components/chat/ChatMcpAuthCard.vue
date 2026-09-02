<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { PendingMcpAuthView } from '@/types/chat/pending-mcp-auth'
import type { McpConfig, McpServerConfig } from '@/types/vixl/mcp-config'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'
import ChatMcpSecretsForm from '@/components/chat/ChatMcpSecretsForm.vue'
import McpServerIcon from '@/components/mcp/ServerIcon.vue'
import { listEffectiveMcpServers } from '@/services/mcp/merge-mcp-config'
import { saveStaticOAuthClient } from '@/services/mcp/oauth'

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
const clientIdDraft = ref('')
const clientSecretDraft = ref('')
const savingClient = ref(false)

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

const persistStaticClient = async (): Promise<boolean> => {
  const clientId = clientIdDraft.value.trim()
  if (clientId.length === 0) {
    if (secretsSavedOnce.value) {
      return true
    }
    toast.error('OAuth client ID is required', {
      description: 'This authorization server does not support dynamic registration.',
    })
    return false
  }
  try {
    await saveStaticOAuthClient(props.auth.serverId, {
      client_id: clientId,
      client_secret: clientSecretDraft.value,
    })
    clientSecretDraft.value = ''
    secretsSavedOnce.value = true
    return true
  } catch (error) {
    toast.error('Failed to save OAuth client', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    return false
  }
}

const handleAuthenticate = async (): Promise<void> => {
  try {
    if (props.auth.kind === 'client') {
      savingClient.value = true
      try {
        const saved = await persistStaticClient()
        if (!saved) {
          return
        }
      } finally {
        savingClient.value = false
      }
    }
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

const handleSaveClient = async (): Promise<void> => {
  savingClient.value = true
  try {
    const saved = await persistStaticClient()
    if (!saved) {
      return
    }
    emit('secretsSaved', props.auth.toolCallId, props.auth.serverId)
  } finally {
    savingClient.value = false
  }
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

    <div
      v-if="auth.kind === 'client'"
      class="space-y-3"
    >
      <div class="space-y-2">
        <Label for="mcp-oauth-client-id">OAuth client ID</Label>
        <Input
          id="mcp-oauth-client-id"
          v-model="clientIdDraft"
          placeholder="Client ID from the authorization server"
        />
      </div>
      <div class="space-y-2">
        <Label for="mcp-oauth-client-secret">Client secret (optional)</Label>
        <Input
          id="mcp-oauth-client-secret"
          v-model="clientSecretDraft"
          type="password"
          placeholder="Stored in the keychain only"
        />
      </div>
      <Button
        size="sm"
        variant="outline"
        :disabled="savingClient"
        @click="handleSaveClient"
      >
        Save client ID
      </Button>
    </div>

    <div class="flex flex-wrap gap-2">
      <Button
        size="sm"
        :disabled="savingClient"
        @click="handleAuthenticate"
      >
        {{
          auth.kind === 'inputs' || auth.kind === 'client'
            ? (secretsSavedOnce ? 'Continue' : 'Authenticate')
            : 'Authenticate'
        }}
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
