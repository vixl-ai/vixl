<script setup lang="ts">
defineProps<{
  content: string
}>()

const { transparencyEnabled } = useTransparency()
</script>

<template>
  <div
    class="h-full min-h-0 overflow-y-auto"
    :class="transparencyEnabled ? 'bg-background' : ''"
  >
    <div class="px-4 py-3 text-sm">
      <MarkdownWithMermaid
        v-if="content.trim()"
        :content="content"
      />
    </div>
  </div>
</template>
