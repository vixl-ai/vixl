<script setup lang="ts">
import { computed } from 'vue'
import SettingsNav from '@/components/settings/SettingsNav.vue'
import ProvidersSection from '@/components/settings/sections/ProvidersSection.vue'
import ModelsSection from '@/components/settings/sections/ModelsSection.vue'
import McpServersSection from '@/components/settings/sections/McpServersSection.vue'
import GeneralSection from '@/components/settings/sections/GeneralSection.vue'
import AppearanceSection from '@/components/settings/sections/AppearanceSection.vue'
import GraphsSection from '@/components/settings/sections/GraphsSection.vue'
import AgentsSection from '@/components/settings/sections/AgentsSection.vue'
import PermissionsSection from '@/components/settings/sections/PermissionsSection.vue'
import PlansSection from '@/components/settings/sections/PlansSection.vue'
import SkillsSection from '@/components/settings/sections/SkillsSection.vue'
import RulesSection from '@/components/settings/sections/RulesSection.vue'
import LspServersSection from '@/components/settings/sections/LspServersSection.vue'
import type { SettingsSectionId } from '@/types/settings/settings-section'

const props = defineProps<{
  activeSection: SettingsSectionId
}>()

const emit = defineEmits<{
  'update:section': [SettingsSectionId]
}>()

const sectionComponent = computed(() => {
  switch (props.activeSection) {
    case 'providers':
      return ProvidersSection
    case 'models':
      return ModelsSection
    case 'mcp':
      return McpServersSection
    case 'general':
      return GeneralSection
    case 'appearance':
      return AppearanceSection
    case 'graphs':
      return GraphsSection
    case 'agents':
      return AgentsSection
    case 'permissions':
      return PermissionsSection
    case 'plans':
      return PlansSection
    case 'skills':
      return SkillsSection
    case 'rules':
      return RulesSection
    case 'lsp':
      return LspServersSection
    default:
      return GeneralSection
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-semibold tracking-tight">Settings</h1>
    </div>

    <SettingsNav
      :active-section="activeSection"
      @select="emit('update:section', $event)"
    />

    <div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <component
        :is="sectionComponent"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
        tab="personal"
      />
    </div>
  </div>
</template>
