<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { scrollOptionIntoMenu } from '@/components/chat/prompt-editor/scroll-option-into-menu'
import highlightQueryMatches from '@/utils/highlight-query-matches'
import type { ContextMention } from '@/types/harness/context-mention'

const props = defineProps<{
  items: string[]
  loading?: boolean
  query: string
  command: (mention: ContextMention) => void
}>()

const selectedIndex = ref(0)
const menuEl = ref<HTMLElement | null>(null)

watch(
  () => props.items,
  () => {
    selectedIndex.value = 0
    if (menuEl.value) {
      menuEl.value.scrollTop = 0
    }
  },
)

const scrollSelectedOption = async (): Promise<void> => {
  await nextTick()
  const container = menuEl.value
  if (!container) {
    return
  }
  const option = container.querySelector(
    `[data-option-index="${selectedIndex.value}"]`,
  )
  if (!(option instanceof HTMLElement)) {
    return
  }
  scrollOptionIntoMenu(container, option)
}

const hasItems = computed(() => props.items.length > 0)

const highlightedItems = computed(() =>
  props.items.map((path) => ({
    path,
    segments: highlightQueryMatches(path, props.query),
  })),
)

const selectIndex = (index: number): void => {
  const path = props.items[index]
  if (!path) {
    return
  }
  props.command({ type: 'file', path })
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
    void scrollSelectedOption()
    return true
  }
  if (event.key === 'ArrowUp') {
    selectedIndex.value =
      (selectedIndex.value + props.items.length - 1) % props.items.length
    void scrollSelectedOption()
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
    ref="menuEl"
    class="z-50 max-h-56 w-[28rem] max-w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-border/60 bg-popover py-1 text-popover-foreground shadow-md"
    data-chat-mention-suggestion
  >
    <p
      v-if="loading && !hasItems"
      class="px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      Searching...
    </p>
    <p
      v-else-if="!hasItems"
      class="px-2.5 py-1.5 text-xs text-muted-foreground"
    >
      No files match
    </p>
    <button
      v-for="(item, index) in highlightedItems"
      :key="item.path"
      type="button"
      :data-option-index="index"
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
      <span class="min-w-0 flex-1 truncate font-mono text-xs">
        <span
          v-for="(segment, segmentIndex) in item.segments"
          :key="`${item.path}:${segmentIndex}`"
          :class="segment.matched ? 'chat-mention-match' : 'text-muted-foreground'"
        >{{ segment.text }}</span>
      </span>
    </button>
  </div>
</template>
