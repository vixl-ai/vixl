<script setup lang="ts">
import VixlFilesSection from '@/components/settings/sections/VixlFilesSection.vue'
import type { SettingsTab } from '@/composables/use-vixl-config'

defineProps<{
  tab: SettingsTab
}>()
</script>

<template>
  <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <AgentsMdFileCard :tab="tab" />
    <VixlFilesSection
      :tab="tab"
      kind="rules"
      folder-label="rules"
      title="Rules"
      empty-message="No rules"
    />
  </div>
</template>
