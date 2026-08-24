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
    kind="studio"
    folder-label="studio"
    title="Studio"
    empty-message="No studios"
  />
</template>
