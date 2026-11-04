<script setup lang="ts">
import { Skeleton } from '@/components/shadcn/ui/skeleton'

const rowWidths = [34, 62, 48, 73, 41, 56, 37, 68, 45, 77, 52, 33, 64, 43, 71, 39, 58, 46, 75, 36, 61, 50, 69, 42]

const rows = Array.from({ length: 24 }, (_, index) => `${rowWidths[index % rowWidths.length]}%`)
</script>

<template>
  <div
    class="flex h-full flex-col overflow-hidden"
    role="status"
    aria-busy="true"
    aria-label="Loading files"
  >
    <div
      v-for="(width, index) in rows"
      :key="index"
      class="flex shrink-0 items-center gap-1 px-2 py-1"
    >
      <Skeleton class="size-4 shrink-0 rounded-sm" />
      <Skeleton
        class="h-3.5"
        :style="{ width }"
      />
    </div>
  </div>
</template>
