<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { Badge } from '@/components/shadcn/ui/badge'
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import type { McpConfig, McpInputDefinition, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer } from '@/types/vixl/mcp-config'
import {
  clearMcpInputValues,
  listRequiredInputIdsForServer,
  loadMcpInputValues,
  saveMcpInputValues,
} from '@/services/mcp/resolve-mcp-inputs'
import { getSecret } from '@/services/vixl/vixl-tauri'
import { mcpInputKey } from '@/services/mcp/mcp-keychain-keys'

const props = defineProps<{
  serverId: string
  serverConfig: McpServerConfig
  mcpConfig: McpConfig
  showOAuthActions?: boolean
  oauthStatus?: string
}>()

const emit = defineEmits<{
  saved: []
  signIn: []
  logOut: []
}>()

const saving = ref(false)
const configured = ref<Record<string, boolean>>({})
const drafts = reactive<Record<string, string>>({})
const clearFlags = reactive<Record<string, boolean>>({})

const inputDefs = computed((): McpInputDefinition[] => {
  const required = listRequiredInputIdsForServer(props.serverConfig)
  return required.map((inputId) => {
    const fromConfig = props.mcpConfig.inputs?.find((item) => item.id === inputId)
    if (fromConfig) {
      return fromConfig
    }
    return {
      id: inputId,
      type: 'promptString',
      description: `Value for ${inputId}`,
      password: true,
    }
  })
})

const isHttp = computed(() => isMcpHttpServer(props.serverConfig))

const refreshConfigured = async (): Promise<void> => {
  const ids = inputDefs.value.map((item) => item.id)
  const next: Record<string, boolean> = {}
  for (const inputId of ids) {
    const stored = await getSecret(mcpInputKey(props.serverId, inputId))
    next[inputId] = stored !== null && stored.length > 0
    if (!(inputId in drafts)) {
      drafts[inputId] = ''
    }
    clearFlags[inputId] = false
  }
  configured.value = next
}

watch(
  () => [props.serverId, props.serverConfig] as const,
  async () => {
    try {
      await refreshConfigured()
    } catch (error) {
      toast.error('Failed to load MCP secrets', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  },
  { immediate: true },
)

onMounted(async () => {
  try {
    await refreshConfigured()
  } catch (error) {
    toast.error('Failed to load MCP secrets', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

const handleSave = async (): Promise<void> => {
  saving.value = true
  try {
    const toSave: Record<string, string> = {}
    const toClear: string[] = []
    for (const def of inputDefs.value) {
      if (clearFlags[def.id]) {
        toClear.push(def.id)
        continue
      }
      const value = (drafts[def.id] ?? '').trim()
      if (value.length > 0) {
        toSave[def.id] = value
      }
    }
    if (toClear.length > 0) {
      await clearMcpInputValues(props.serverId, toClear)
    }
    if (Object.keys(toSave).length > 0) {
      await saveMcpInputValues(props.serverId, toSave)
    }
    for (const key of Object.keys(drafts)) {
      drafts[key] = ''
      clearFlags[key] = false
    }
    await refreshConfigured()
    toast.success('MCP secrets saved')
    emit('saved')
  } catch (error) {
    toast.error('Failed to save MCP secrets', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    saving.value = false
  }
}

const markClear = (inputId: string): void => {
  clearFlags[inputId] = true
  drafts[inputId] = ''
}

/** Expose load for mid-run: ensure missing inputs are detected. */
const hasMissing = async (): Promise<boolean> => {
  const ids = inputDefs.value.map((item) => item.id)
  const { missing } = await loadMcpInputValues(props.serverId, ids)
  return missing.length > 0
}

defineExpose({ hasMissing, refreshConfigured })
</script>

<template>
  <div class="space-y-4">
    <p class="text-sm text-muted-foreground">
      Update keychain values for this server. Leave a field blank to keep the saved value.
    </p>
    <p
      v-if="inputDefs.length === 0"
      class="text-sm text-muted-foreground"
    >
      This server has no secrets. Add env or header names when editing the server.
    </p>
    <div
      v-for="def in inputDefs"
      :key="def.id"
      class="space-y-2"
    >
      <div class="flex items-center gap-2">
        <Label :for="`mcp-secret-${def.id}`">{{ def.id }}</Label>
        <Badge
          v-if="configured[def.id] && !clearFlags[def.id]"
          variant="outline"
        >
          Configured
        </Badge>
        <Badge
          v-else
          variant="secondary"
        >
          Missing
        </Badge>
      </div>
      <p
        v-if="def.description"
        class="text-xs text-muted-foreground"
      >
        {{ def.description }}
      </p>
      <SettingsInputPasswordInput
        :id="`mcp-secret-${def.id}`"
        v-model="drafts[def.id]"
        :placeholder="
          configured[def.id] && !clearFlags[def.id]
            ? 'Leave blank to keep current value'
            : 'Enter secret'
        "
      />
      <Button
        v-if="configured[def.id]"
        type="button"
        size="sm"
        variant="ghost"
        class="text-destructive hover:text-destructive"
        @click="markClear(def.id)"
      >
        Clear stored value
      </Button>
    </div>

    <div
      v-if="showOAuthActions && isHttp"
      class="flex flex-wrap gap-2"
    >
      <Button
        type="button"
        size="sm"
        variant="outline"
        @click="emit('signIn')"
      >
        Sign in with browser
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        @click="emit('logOut')"
      >
        Log out
      </Button>
      <Badge
        v-if="oauthStatus"
        variant="outline"
      >
        {{ oauthStatus }}
      </Badge>
    </div>

    <div
      v-if="inputDefs.length > 0"
      class="flex justify-end"
    >
      <Button
        type="button"
        size="sm"
        :disabled="saving"
        @click="handleSave"
      >
        Save secrets
      </Button>
    </div>
  </div>
</template>
