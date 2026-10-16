<script setup lang="ts">
import { computed } from 'vue'
import { Layers, Layers2 } from '@lucide/vue'
import useFleetRegistry from '@/composables/use-fleet-registry'

const props = defineProps<{
  slug: string
  open: boolean
}>()

const fleet = useFleetRegistry()

const icon = computed(() => {
  const group = fleet.groups.value.find((item) => item.slug === props.slug)
  return (group?.memberSlugs.length ?? 0) >= 3 ? Layers : Layers2
})
</script>

<template>
  <component
    :is="icon"
    class="group-stack-icon size-4 shrink-0"
    :class="{ 'is-open': open }"
  />
</template>

<style scoped>
.group-stack-icon :deep(path) {
  transition: transform 250ms ease-out;
}

.group-stack-icon.is-open :deep(path:first-of-type) {
  transform: translateY(-1.5px);
}

.group-stack-icon.is-open :deep(path:last-of-type) {
  transform: translateY(1.5px);
}
</style>
