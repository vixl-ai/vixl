<script setup lang="ts">
import { Plus, Trash2 } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import { Badge } from '@/components/shadcn/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/shadcn/ui/dialog'
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import type {
  McpConfig,
  McpInputDefinition,
  McpServerConfig,
} from '@/types/vixl/mcp-config'
import useManageMcpServerDialog from '@/composables/manage-mcp-server-dialog'

const props = defineProps<{
  open: boolean
  mode: 'create' | 'edit'
  serverId?: string | null
  initialConfig?: McpServerConfig | null
  mcpConfig: McpConfig
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
  save: [
    payload: {
      serverId: string
      previousId?: string
      config: McpServerConfig
      inputs: McpInputDefinition[]
      secretValues: Record<string, string>
    },
  ]
}>()

const {
  draftId,
  transport,
  command,
  argsText,
  url,
  envRows,
  headerRows,
  oauthClientId,
  asAllowlistText,
  addEnvRow,
  addHeaderRow,
  handleSave,
} = useManageMcpServerDialog(props, emit)
</script>

<template>
  <Dialog
    :open="open"
    @update:open="(value) => emit('update:open', value)"
  >
    <DialogContent class="max-h-[90vh] overflow-y-auto sm:max-w-xl">
      <div class="space-y-4">
        <div class="space-y-2">
          <Label>Server ID</Label>
          <Input
            v-model="draftId"
            :disabled="mode === 'edit'"
            placeholder="brave-search"
          />
        </div>

        <div class="space-y-2">
          <Label>Transport</Label>
          <select
            v-model="transport"
            class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs"
          >
            <option value="stdio">stdio</option>
            <option value="http">http</option>
            <option value="sse">sse</option>
          </select>
        </div>

        <template v-if="transport === 'stdio'">
          <div class="space-y-2">
            <Label>Command</Label>
            <Input
              v-model="command"
              placeholder="npx"
            />
            <p class="text-xs text-muted-foreground">
              PATH basename only (for example npx or uvx). Review before trusting.
            </p>
          </div>
          <div class="space-y-2">
            <Label>Args (comma-separated)</Label>
            <Input
              v-model="argsText"
              placeholder="-y, @brave/brave-search-mcp-server, --transport, stdio"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <Label>Secrets (env)</Label>
                <p class="text-xs text-muted-foreground">
                  Name the env var and enter its value once. Vixl wires it for the process.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                @click="addEnvRow"
              >
                <Plus class="h-4 w-4" />
                Add
              </Button>
            </div>
            <div
              v-for="(row, index) in envRows"
              :key="`env-${index}`"
              class="space-y-2 rounded-md border border-border/50 p-3"
            >
              <div class="flex items-center gap-2">
                <Input
                  v-model="row.key"
                  class="flex-1"
                  placeholder="BRAVE_API_KEY"
                />
                <Badge
                  v-if="row.configured && !row.value.trim()"
                  variant="outline"
                >
                  Saved
                </Badge>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  @click="envRows = envRows.filter((_, i) => i !== index)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
              <SettingsInputPasswordInput
                v-model="row.value"
                :placeholder="
                  row.configured
                    ? 'Leave blank to keep saved value'
                    : 'Paste secret'
                "
              />
            </div>
          </div>
        </template>

        <template v-else>
          <div class="space-y-2">
            <Label>URL</Label>
            <Input
              v-model="url"
              placeholder="https://example.com/mcp"
            />
          </div>

          <div class="space-y-2">
            <div class="flex items-center justify-between gap-2">
              <div>
                <Label>Secrets (headers)</Label>
                <p class="text-xs text-muted-foreground">
                  Header name and value. Enter the secret once; it is stored in the keychain.
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                @click="addHeaderRow"
              >
                <Plus class="h-4 w-4" />
                Add
              </Button>
            </div>
            <div
              v-for="(row, index) in headerRows"
              :key="`header-${index}`"
              class="space-y-2 rounded-md border border-border/50 p-3"
            >
              <div class="flex items-center gap-2">
                <Input
                  v-model="row.key"
                  class="flex-1"
                  placeholder="Authorization"
                />
                <Badge
                  v-if="row.configured && !row.value.trim()"
                  variant="outline"
                >
                  Saved
                </Badge>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  @click="headerRows = headerRows.filter((_, i) => i !== index)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>
              <SettingsInputPasswordInput
                v-model="row.value"
                :placeholder="
                  row.configured
                    ? 'Leave blank to keep saved value'
                    : 'Paste secret'
                "
              />
            </div>
          </div>

          <div class="space-y-2">
            <Label>OAuth client ID (optional)</Label>
            <Input
              v-model="oauthClientId"
              placeholder="Leave blank for dynamic registration"
            />
          </div>
          <div class="space-y-2">
            <Label>Allowed authorization servers (optional)</Label>
            <p class="text-xs text-muted-foreground">
              One origin URL per line. If empty, you confirm the server on first login.
            </p>
            <textarea
              v-model="asAllowlistText"
              class="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
              placeholder="https://auth.example.com"
            />
          </div>
        </template>
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          @click="emit('update:open', false)"
        >
          Cancel
        </Button>
        <Button
          type="button"
          @click="handleSave"
        >
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
