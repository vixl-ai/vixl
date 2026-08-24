<script setup lang="ts">
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/shadcn/ui/sheet'

defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
}>()
</script>

<template>
  <Sheet :open="open" @update:open="emit('update:open', $event)">
    <SheetContent side="right" class="w-full sm:max-w-md overflow-y-auto">
      <SheetTitle class="sr-only">Create</SheetTitle>
      <div class="px-4 pt-6 pb-6">
        <slot />
      </div>
    </SheetContent>
  </Sheet>
</template>
