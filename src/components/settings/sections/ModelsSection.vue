<script setup lang="ts">
import { computed } from 'vue'
import { CircleHelpIcon, TriangleAlertIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { Switch } from '@/components/shadcn/ui/switch'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import ModelsOptionsModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import type { SettingsTab } from '@/composables/use-vixl-config'
import {
  MODEL_ROLE_REGISTRY,
  type ModelRoleDefinition,
} from '@/data/model-role-registry'
import listConfiguredProviders from '@/services/providers/list-configured-providers'

const props = defineProps<{
  tab: SettingsTab
}>()

const config = useVixlConfig()

const settings = computed(() => config.getScopeSettings(props.tab))

const hasProviders = computed(() => listConfiguredProviders(settings.value).length > 0)

const autoTitleEnabled = computed(() => settings.value['chat.autoTitle'] !== false)

const roles = MODEL_ROLE_REGISTRY.filter((role) => role.id !== 'subagent')

const subagentRole = MODEL_ROLE_REGISTRY.find((role) => role.id === 'subagent')!

const roleModelValue = (role: ModelRoleDefinition): string => {
  const value = settings.value[role.settingsKey]
  return typeof value === 'string' ? value : ''
}

const isRoleOverridden = (role: ModelRoleDefinition): boolean => {
  const value = settings.value[role.settingsKey]
  return typeof value === 'string' && value.length > 0
}

const showDefaultWarning = (role: ModelRoleDefinition): boolean =>
  Boolean(role.recommendCheapModel) &&
  role.id !== 'default' &&
  !isRoleOverridden(role)

const handleModelChange = async (
  role: ModelRoleDefinition,
  value: string,
): Promise<void> => {
  if (props.tab === 'project' && !config.activeRootPath.value) {
    toast.error('Failed to save model', {
      description: 'No active project',
    })
    return
  }

  try {
    await config.updateSetting(props.tab, role.settingsKey, value)
    toast.success('Model saved')
  } catch (error) {
    toast.error('Failed to save model', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const clearRoleOverride = async (role: ModelRoleDefinition): Promise<void> => {
  if (props.tab === 'project' && !config.activeRootPath.value) {
    toast.error('Failed to clear override', {
      description: 'No active project',
    })
    return
  }

  try {
    await config.removeSettings(props.tab, [
      role.settingsKey,
      role.reasoningSettingsKey,
    ])
    toast.success('Using default model')
  } catch (error) {
    toast.error('Failed to clear override', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const setAutoTitle = async (value: boolean): Promise<void> => {
  try {
    await config.updateSetting(props.tab, 'chat.autoTitle', value)
  } catch (error) {
    toast.error('Failed to save auto-title setting', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const defaultModel = computed(() => settings.value['models.default'] ?? '')

const modelPlaceholder = (role: ModelRoleDefinition): string => {
  if (role.id === 'default') {
    return 'Select default model'
  }
  return defaultModel.value ? 'Using default' : 'Select model'
}
</script>

<template>
  <SettingsSectionScroll title="Models">
    <div
      v-if="!hasProviders"
      class="flex items-center justify-center rounded-lg border border-dashed border-border/60 px-4 py-12"
    >
      <p class="text-sm text-muted-foreground">
        Configure at least one provider before choosing models.
      </p>
    </div>

    <TooltipProvider v-else>
      <div class="flex flex-col gap-5">
        <div
          v-for="role in roles"
          :key="role.id"
          class="flex flex-col gap-2"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-2">
            <Label class="text-sm font-medium">{{ role.label }}</Label>
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="inline-flex text-muted-foreground hover:text-foreground"
                  :aria-label="`${role.label} description`"
                >
                  <CircleHelpIcon class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs">
                {{ role.description }}
              </TooltipContent>
            </Tooltip>
            <Tooltip v-if="showDefaultWarning(role)">
              <TooltipTrigger as-child>
                <button
                  type="button"
                  class="inline-flex text-amber-500 hover:text-amber-400"
                  :aria-label="`${role.label} is using the default model`"
                >
                  <TriangleAlertIcon class="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent class="max-w-xs">
                Using the default model. Prefer a small, low-cost model for this background task.
              </TooltipContent>
            </Tooltip>
            <Button
              v-if="role.id !== 'default' && role.id !== 'orchestrator' && isRoleOverridden(role)"
              variant="ghost"
              size="sm"
              class="h-7 px-2 text-xs"
              @click="clearRoleOverride(role)"
            >
              Use default
            </Button>
          </div>

          <div
            v-if="role.id === 'title'"
            class="flex items-center gap-2"
          >
            <Switch
              id="auto-title"
              :model-value="autoTitleEnabled"
              @update:model-value="setAutoTitle"
            />
            <Label for="auto-title" class="text-xs font-normal text-muted-foreground">
              Auto-title
            </Label>
          </div>

          <template v-if="role.id === 'orchestrator'">
            <div class="flex max-w-md flex-col gap-3">
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <Label class="text-xs font-normal text-muted-foreground">
                    Parent
                  </Label>
                  <Button
                    v-if="isRoleOverridden(role)"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-2 text-xs"
                    @click="clearRoleOverride(role)"
                  >
                    Use default
                  </Button>
                </div>
                <ModelsOptionsModelOptionsRow
                  :model-value="roleModelValue(role)"
                  :scope-settings="settings"
                  :options-tab="tab"
                  :disabled="!hasProviders"
                  :placeholder="modelPlaceholder(role)"
                  @update:model-value="handleModelChange(role, $event)"
                />
              </div>
              <div class="flex flex-col gap-1.5">
                <div class="flex items-center gap-2">
                  <Label class="text-xs font-normal text-muted-foreground">
                    Subagent
                  </Label>
                  <Tooltip>
                    <TooltipTrigger as-child>
                      <button
                        type="button"
                        class="inline-flex text-muted-foreground hover:text-foreground"
                        aria-label="Subagent description"
                      >
                        <CircleHelpIcon class="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent class="max-w-xs">
                      {{ subagentRole.description }}
                    </TooltipContent>
                  </Tooltip>
                  <Button
                    v-if="isRoleOverridden(subagentRole)"
                    variant="ghost"
                    size="sm"
                    class="h-6 px-2 text-xs"
                    @click="clearRoleOverride(subagentRole)"
                  >
                    Use default
                  </Button>
                </div>
                <ModelsOptionsModelOptionsRow
                  :model-value="roleModelValue(subagentRole)"
                  :scope-settings="settings"
                  :options-tab="tab"
                  :disabled="!hasProviders"
                  :placeholder="modelPlaceholder(subagentRole)"
                  @update:model-value="handleModelChange(subagentRole, $event)"
                />
              </div>
            </div>
          </template>

          <div
            v-else
            class="min-w-0 max-w-md"
          >
            <ModelsOptionsModelOptionsRow
              :model-value="roleModelValue(role)"
              :scope-settings="settings"
              :options-tab="tab"
              :disabled="!hasProviders || (role.id === 'title' && !autoTitleEnabled)"
              :placeholder="modelPlaceholder(role)"
              @update:model-value="handleModelChange(role, $event)"
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  </SettingsSectionScroll>
</template>
