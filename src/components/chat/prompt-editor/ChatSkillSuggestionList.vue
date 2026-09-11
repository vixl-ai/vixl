<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import highlightQueryMatches from '@/utils/highlight-query-matches'
import type { ContextMention } from '@/types/harness/context-mention'
import type { SlashIndexEntry } from '@/types/chat/slash-index-entry'

const props = defineProps<{
  items: SlashIndexEntry[]
  loading?: boolean
  query: string
  command: (mention: ContextMention) => void
}>()

const selectedIndex = ref(0)

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
  },
)

const hasItems = computed(() => props.items.length > 0)

const highlightedItems = computed(() =>
  props.items.map((entry) => ({
    entry,
    label: `/${entry.name}`,
    segments: highlightQueryMatches(`/${entry.name}`, props.query),
  })),
)

const selectIndex = (index: number): void => {
  const entry = props.items[index]
  if (!entry) {
    return
  }
  if (entry.kind === 'agent') {
    props.command({ type: 'agent', name: entry.name })
    return
  }
  props.command({ type: 'skill', name: entry.name })
}

const handlePrimaryAction = (): boolean => {
  if (!hasItems.value) {
    return false
  }
  selectIndex(selectedIndex.value)
  return true
}

const onKeyDown = (event: KeyboardEvent): boolean => {
  if (!hasItems.value) {
    return false
  }
  if (event.key === 'ArrowDown') {
    selectedIndex.value = (selectedIndex.value + 1) % props.items.length
    return true
  }
  if (event.key === 'ArrowUp') {
    selectedIndex.value =
      (selectedIndex.value + props.items.length - 1) % props.items.length
    return true
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    return handlePrimaryAction()
  }
  return false
}

defineExpose({
  handlePrimaryAction,
  onKeyDown,
})
</script>

<template>
  <div
    v-if="hasItems || loading || query.trim().length > 0"
    class="z-50 max-h-56 w-72 overflow-y-auto rounded-md border border-border/60 bg-popover py-1 text-popover-foreground shadow-md"
    data-chat-skill-suggestion
  >
    <p
      v-if="loading && !hasItems"
      class="px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      Loading...
    </p>
    <p
      v-else-if="!hasItems"
      class="px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      No matches
    </p>
    <button
      v-for="(item, index) in highlightedItems"
      :key="`${item.entry.kind}:${item.entry.scope}:${item.entry.name}`"
      type="button"
      class="flex w-full min-w-0 items-center px-2.5 py-1.5 text-left text-sm"
      :class="
        index === selectedIndex
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/60'
      "
      @mousedown.prevent
      @mouseenter="selectedIndex = index"
      @click="selectIndex(index)"
    >
      <span class="min-w-0 w-full truncate font-mono text-xs">
        <span
          v-for="(segment, segmentIndex) in item.segments"
          :key="`${item.label}:${segmentIndex}`"
          :class="segment.matched ? 'chat-skill-match' : 'text-muted-foreground'"
        >{{ segment.text }}</span>
      </span>
    </button>
  </div>
</template>
