<script setup lang="ts">
import { Marker, MarkerContent } from '@/components/shadcn/ui/marker'

defineProps<{
  pending?: boolean
}>()
</script>

<template>
  <Marker variant="default" class="w-full">
    <MarkerContent>
      <span v-if="pending" class="shimmer shimmer-duration-1500 shimmer-angle-0"> Compacting </span>
      <template v-else> Compacted </template>
    </MarkerContent>
  </Marker>
</template>
