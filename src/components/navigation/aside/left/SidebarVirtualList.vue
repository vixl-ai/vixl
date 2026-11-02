<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { sidebarVirtualRange } from '@/utils/sidebar-virtual-range'

const SIDEBAR_LIST_VIEWPORT = 168

const props = withDefaults(
  defineProps<{
    count: number
    estimate?: number
    keyAt: (index: number) => string
    class?: HTMLAttributes['class']
  }>(),
  { estimate: 34 },
)

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewport = ref(SIDEBAR_LIST_VIEWPORT)
const measured = ref<number[]>([])
const rowNodes = new Map<number, HTMLElement>()
let scrollerObserver: ResizeObserver | null = null
let rowObserver: ResizeObserver | null = null

const heightAt = (index: number): number => measured.value[index] ?? props.estimate

const readViewport = (node: HTMLElement): number => {
  const height = node.clientHeight
  if (!height) {
    return SIDEBAR_LIST_VIEWPORT
  }
  return Math.min(height, SIDEBAR_LIST_VIEWPORT)
}

const layout = computed(() =>
  sidebarVirtualRange({
    count: props.count,
    scrollTop: scrollTop.value,
    viewport: viewport.value,
    heightAt,
  }),
)

const rows = computed(() => {
  const next: { index: number; key: string; top: number }[] = []
  let top = layout.value.offset
  for (let index = layout.value.start; index < layout.value.end; index += 1) {
    next.push({
      index,
      key: props.keyAt(index),
      top,
    })
    top += heightAt(index)
  }
  return next
})

const onScroll = (): void => {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

const setMeasured = (index: number, height: number): void => {
  const next = Math.ceil(height)
  if (next <= 0 || measured.value[index] === next) {
    return
  }
  const copy = measured.value.slice()
  copy[index] = next
  measured.value = copy
}

const bindRow = (index: number, element: unknown): void => {
  const previous = rowNodes.get(index)
  if (previous && previous !== element && rowObserver) {
    rowObserver.unobserve(previous)
  }
  if (!(element instanceof HTMLElement)) {
    rowNodes.delete(index)
    return
  }
  rowNodes.set(index, element)
  rowObserver?.observe(element)
}

watch(
  () => props.count,
  (count) => {
    if (measured.value.length > count) {
      measured.value = measured.value.slice(0, count)
    }
  },
)

onMounted(() => {
  const node = scroller.value
  if (!node || typeof ResizeObserver === 'undefined') {
    return
  }
  viewport.value = readViewport(node)
  scrollerObserver = new ResizeObserver(() => {
    viewport.value = readViewport(node)
  })
  scrollerObserver.observe(node)
  rowObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      for (const [index, element] of rowNodes) {
        if (element !== entry.target) {
          continue
        }
        setMeasured(index, entry.contentRect.height)
        break
      }
    }
  })
  for (const element of rowNodes.values()) {
    rowObserver.observe(element)
  }
})

onBeforeUnmount(() => {
  scrollerObserver?.disconnect()
  rowObserver?.disconnect()
  rowNodes.clear()
})
</script>

<template>
  <div
    ref="scroller"
    data-sidebar-virtual-list
    :class="cn(
      'min-w-0 max-h-42 min-h-0 scroll-fade-b scrollbar-none overflow-x-hidden overflow-y-auto',
      props.class,
    )"
    :style="{ maxHeight: `${SIDEBAR_LIST_VIEWPORT}px`, minHeight: '0' }"
    @scroll="onScroll"
  >
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-badge"
      class="border-sidebar-border relative mx-0 flex min-w-0 translate-x-px flex-col border-l"
      :style="{ height: `${layout.total}px` }"
    >
      <li
        v-for="row in rows"
        :key="row.key"
        :ref="(element) => bindRow(row.index, element)"
        data-sidebar="menu-sub-item"
        class="absolute right-2.5 left-2.5"
        :style="{ top: `${row.top}px` }"
      >
        <slot :index="row.index" />
      </li>
    </ul>
  </div>
</template>
