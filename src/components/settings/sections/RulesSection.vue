<script setup lang="ts">
import { ref } from 'vue'
import type { SettingsTab } from '@/composables/use-vixl-config'

defineProps<{
  tab: SettingsTab
}>()

const view = ref<'agents-md' | 'rules'>('agents-md')
</script>

<template>
  <SettingsSectionScroll v-if="view === 'agents-md'">
    <template #title>
      <RulesKindSelect v-model="view" />
    </template>
    <AgentsMdFileCard :tab="tab" hide-heading />
  </SettingsSectionScroll>
  <VixlFilesSection
    v-else
    :tab="tab"
    kind="rules"
    folder-label="rules"
    title="Rules"
    empty-message="No rules"
  >
    <template #title>
      <RulesKindSelect v-model="view" />
    </template>
  </VixlFilesSection>
</template>
