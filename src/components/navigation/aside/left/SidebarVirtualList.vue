<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch, type HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import {
  bindMeasuredRow,
  heightForKey,
  pruneMeasuredHeights,
  recordMeasuredHeight,
  unbindMeasuredRow,
} from '@/utils/sidebar-measure-store'
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
const measured = shallowRef<ReadonlyMap<string, number>>(new Map())
const keyToEl = new Map<string, Element>()
const elToKey = new Map<Element, string>()
let scrollerObserver: ResizeObserver | null = null
let rowObserver: ResizeObserver | null = null

const heightAt = (index: number): number =>
  heightForKey(measured.value, props.keyAt(index), props.estimate)

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

const frameHeight = computed(() => {
  if (props.count <= 0) {
    return 0
  }
  return Math.min(layout.value.total, SIDEBAR_LIST_VIEWPORT)
})

const rows = computed(() => {
  const next: { index: number; key: string; top: number }[] = []
  let top = layout.value.offset
  for (let index = layout.value.start; index < layout.value.end; index += 1) {
    const key = props.keyAt(index)
    next.push({
      index,
      key,
      top,
    })
    top += heightForKey(measured.value, key, props.estimate)
  }
  return next
})

const onScroll = (): void => {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

const setMeasured = (key: string, height: number): void => {
  const next = recordMeasuredHeight(measured.value, key, height)
  if (next !== measured.value) {
    measured.value = next
  }
}

const bindRow = (key: string, element: unknown): void => {
  if (!(element instanceof HTMLElement)) {
    const previous = unbindMeasuredRow(keyToEl, elToKey, key)
    if (previous) {
      rowObserver?.unobserve(previous)
    }
    return
  }
  const detached = bindMeasuredRow(keyToEl, elToKey, key, element)
  if (detached) {
    rowObserver?.unobserve(detached)
  }
  rowObserver?.observe(element)
}

watch(
  () => {
    const keys: string[] = []
    for (let index = 0; index < props.count; index += 1) {
      keys.push(props.keyAt(index))
    }
    return keys
  },
  (keys) => {
    const next = pruneMeasuredHeights(measured.value, keys)
    if (next !== measured.value) {
      measured.value = next
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
      const key = elToKey.get(entry.target)
      if (!key) {
        continue
      }
      setMeasured(key, entry.contentRect.height)
    }
  })
  for (const element of keyToEl.values()) {
    rowObserver.observe(element)
  }
})

onBeforeUnmount(() => {
  scrollerObserver?.disconnect()
  rowObserver?.disconnect()
  keyToEl.clear()
  elToKey.clear()
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
    :style="{
      height: `${frameHeight}px`,
      maxHeight: `${SIDEBAR_LIST_VIEWPORT}px`,
      minHeight: '0',
    }"
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
        :ref="(element) => bindRow(row.key, element)"
        data-sidebar="menu-sub-item"
        class="absolute right-2.5 left-2.5"
        :style="{ top: `${row.top}px` }"
      >
        <slot :index="row.index" />
      </li>
    </ul>
  </div>
</template>
