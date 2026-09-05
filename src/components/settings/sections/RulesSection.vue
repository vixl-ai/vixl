<script setup lang="ts">
import type { SettingsTab } from '@/composables/use-vixl-config'

defineProps<{
  tab: SettingsTab
}>()
</script>

<template>
  <SettingsSectionScroll>
    <div class="flex flex-col gap-6">
      <AgentsMdFileCard :tab="tab" />
      <VixlFilesSection
        :tab="tab"
        kind="rules"
        folder-label="rules"
        title="Rules"
        empty-message="No rules"
        collapsible
      />
    </div>
  </SettingsSectionScroll>
</template>
