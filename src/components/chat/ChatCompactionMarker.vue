<script setup lang="ts">
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'

defineProps<{
  pending?: boolean
}>()
</script>

<template>
  <Marker
    :variant="pending ? 'default' : 'border'"
    class="w-full"
  >
    <MarkerContent>
      <AiElementsShimmerShimmer
        v-if="pending"
        :duration="1.5"
        as="span"
      >
        Compacting
      </AiElementsShimmerShimmer>
      <template v-else>
        Compacted
      </template>
    </MarkerContent>
  </Marker>
</template>
