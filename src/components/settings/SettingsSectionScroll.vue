<script setup lang="ts">
defineProps<{
  title?: string
}>()
</script>

<template>
  <section class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
    <div
      v-if="$slots.header || title || $slots.title"
      class="shrink-0 pb-4"
    >
      <slot name="header">
        <div
          v-if="title || $slots.title"
          class="flex items-center justify-between gap-4"
        >
          <slot name="title">
            <h2 class="text-lg font-medium">{{ title }}</h2>
          </slot>
          <div v-if="$slots.actions" class="flex items-center gap-2">
            <slot name="actions" />
          </div>
        </div>
      </slot>
    </div>
    <div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <slot />
    </div>
  </section>
</template>
