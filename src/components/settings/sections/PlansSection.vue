<script setup lang="ts">
import VixlFilesSection from '@/components/settings/sections/VixlFilesSection.vue'
import type { SettingsTab } from '@/composables/use-vixl-config'

defineProps<{
  tab: SettingsTab
}>()
</script>

<template>
  <VixlFilesSection
    :tab="tab"
    kind="plans"
    folder-label="plans"
    title="Plans"
    empty-message="No plans"
  />
</template>
