<script setup lang="ts">
import type { SettingsTab } from '@/composables/use-vixl-config'
import { KeyRound, Loader2, Pencil, Plus, RefreshCw, Settings2, Trash2 } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { Input } from '@/components/shadcn/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import SettingsInputPasswordInput from '@/components/settings/input/PasswordInput.vue'
import SettingsProvidersManageProviderDialog from '@/components/settings/providers/ManageProviderDialog.vue'
import useProvidersSection from '@/composables/providers-section'

const props = defineProps<{
  tab: SettingsTab
}>()

const {
  testingProviderId,
  addDialogOpen,
  manageDialogOpen,
  manageMode,
  manageProviderId,
  editApiKeyProviderId,
  apiKeyInput,
  providerSearchQuery,
  dialogSurfaceClass,
  settings,
  configuredProviders,
  hasProviders,
  filteredAiSdkProviders,
  filteredOpenAiCompatibleProviders,
  hasProviderSearchResults,
  manageInitialProvider,
  getProviderDisplayName,
  isCustomProvider,
  hasApiKeyInKeychain,
  getCustomModelCount,
  openAddDialog,
  openCreateCustomDialog,
  openEditDialog,
  resolveManageStoredApiKey,
  handleAddDialogOpenChange,
  addProvider,
  handleManageSave,
  saveApiKey,
  clearApiKey,
  removeProvider,
  testConnection,
  providerRequiresApiKey,
} = useProvidersSection(props)
</script>

<template>
  <SettingsSectionScroll title="Providers">
    <template #actions>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Add provider"
            @click="openAddDialog"
          >
            <Plus class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add provider</TooltipContent>
      </Tooltip>
    </template>

    <div
      v-if="!hasProviders"
      class="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-4 py-12"
    >
      <p class="text-sm text-muted-foreground">No providers configured yet.</p>
    </div>

    <template v-else>
      <div class="space-y-2">
        <div
          v-for="providerId in configuredProviders"
          :key="providerId"
          class="flex flex-col gap-3 rounded-lg border border-border/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p class="font-medium">
              {{ getProviderDisplayName(providerId) }}
            </p>
            <p class="text-xs text-muted-foreground">
              {{
                hasApiKeyInKeychain(providerId)
                  ? 'API key configured'
                  : providerRequiresApiKey(providerId, settings)
                    ? 'No API key'
                    : 'API key optional'
              }}<template v-if="isCustomProvider(providerId)">, {{
                  getCustomModelCount(providerId) > 0
                    ? `${getCustomModelCount(providerId)} model${getCustomModelCount(providerId) === 1 ? '' : 's'}`
                    : 'No models configured'
                }}</template>
            </p>
          </div>
          <div class="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  :aria-label="
                    isCustomProvider(providerId)
                      ? 'Manage provider and models'
                      : hasApiKeyInKeychain(providerId)
                        ? 'Edit key'
                        : 'Add key'
                  "
                  @click="openEditDialog(providerId)"
                >
                  <Settings2 v-if="isCustomProvider(providerId)" class="h-4 w-4" />
                  <Pencil v-else class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {{
                  isCustomProvider(providerId)
                    ? 'Manage provider & models'
                    : hasApiKeyInKeychain(providerId)
                      ? 'Edit key'
                      : 'Add key'
                }}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="Test connection"
                  :disabled="testingProviderId === providerId"
                  @click="testConnection(providerId)"
                >
                  <Loader2
                    v-if="testingProviderId === providerId"
                    class="h-4 w-4 animate-spin"
                  />
                  <RefreshCw v-else class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Test connection</TooltipContent>
            </Tooltip>
            <Tooltip v-if="hasApiKeyInKeychain(providerId)">
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8"
                  aria-label="Clear key"
                  @click="clearApiKey(providerId)"
                >
                  <KeyRound class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Clear key</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="h-8 w-8 text-destructive hover:text-destructive"
                  aria-label="Remove provider"
                  @click="removeProvider(providerId)"
                >
                  <Trash2 class="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </template>

    <Dialog :open="addDialogOpen" @update:open="handleAddDialogOpenChange">
      <DialogContent :class="dialogSurfaceClass">
        <DialogHeader>
          <DialogTitle>Add provider</DialogTitle>
        </DialogHeader>
        <Input v-model="providerSearchQuery" placeholder="Search providers…" />
        <div class="max-h-[min(24rem,60vh)] overflow-y-auto">
          <Button
            variant="ghost"
            class="h-auto w-full justify-start px-3 py-2.5 font-normal"
            @click="openCreateCustomDialog"
          >
            Custom OpenAI-compatible
          </Button>
          <template v-if="filteredAiSdkProviders.length > 0">
            <p class="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">AI SDK providers</p>
            <div class="flex flex-col gap-0.5">
              <Button
                v-for="entry in filteredAiSdkProviders"
                :key="entry.id"
                variant="ghost"
                class="h-auto w-full justify-start px-3 py-2.5 font-normal"
                @click="addProvider(entry.id)"
              >
                {{ entry.name }}
              </Button>
            </div>
          </template>
          <template v-if="filteredOpenAiCompatibleProviders.length > 0">
            <p class="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">
              OpenAI-compatible
            </p>
            <div class="flex flex-col gap-0.5">
              <Button
                v-for="entry in filteredOpenAiCompatibleProviders"
                :key="entry.id"
                variant="ghost"
                class="h-auto w-full justify-start px-3 py-2.5 font-normal"
                @click="addProvider(entry.id)"
              >
                {{ entry.name }}
              </Button>
            </div>
          </template>
          <p
            v-if="providerSearchQuery.trim() && !hasProviderSearchResults"
            class="px-3 py-6 text-center text-sm text-muted-foreground"
          >
            No providers match your search.
          </p>
        </div>
      </DialogContent>
    </Dialog>

    <SettingsProvidersManageProviderDialog
      v-model:open="manageDialogOpen"
      :mode="manageMode"
      :provider-id="manageProviderId"
      :initial-provider="manageInitialProvider"
      :initial-api-key-configured="
        manageProviderId ? hasApiKeyInKeychain(manageProviderId) : false
      "
      :resolve-stored-api-key="resolveManageStoredApiKey"
      @save="handleManageSave"
    />

    <Dialog
      :open="!!editApiKeyProviderId"
      @update:open="(open) => !open && (editApiKeyProviderId = null)"
    >
      <DialogContent :class="dialogSurfaceClass">
        <DialogHeader>
          <DialogTitle>
            {{
              editApiKeyProviderId && hasApiKeyInKeychain(editApiKeyProviderId)
                ? 'Edit API key'
                : 'Add API key'
            }}
          </DialogTitle>
        </DialogHeader>
        <SettingsInputPasswordInput v-model="apiKeyInput" placeholder="sk-..." />
        <DialogFooter>
          <Button @click="editApiKeyProviderId && saveApiKey(editApiKeyProviderId)">Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </SettingsSectionScroll>
</template>
