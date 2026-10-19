<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue"
import { cn } from "@/lib/utils"
import { SCROLL_KEYS, useMessageScrollerContext } from "./useMessageScroller"

const props = withDefaults(defineProps<{
  class?: HTMLAttributes["class"]
  preserveScrollOnPrepend?: boolean
}>(), {
  preserveScrollOnPrepend: true,
})

const {
  autoscrolling,
  handleViewportResize,
  isFollowingLive,
  scrollableAttr,
  setPreserveScrollOnPrepend,
  setViewportElement,
  syncAfterScroll,
  userScrollIntent,
} = useMessageScrollerContext()

const viewportEl = useTemplateRef<HTMLElement>("viewport")

watch(() => props.preserveScrollOnPrepend, setPreserveScrollOnPrepend, { immediate: true })

function onKeyDown(event: KeyboardEvent) {
  if (SCROLL_KEYS.has(event.key))
    userScrollIntent()
}

function onPointerScrollIntent() {
  // Wheel and touch at the live edge must not leave follow. @scroll ->
  // syncAfterScroll -> updateModeFromScroll exits only once the view is
  // actually above the edge threshold. Anchored and settling jumps still
  // treat a gesture as user intent.
  if (!isFollowingLive())
    userScrollIntent()
}

let resizeObserver: ResizeObserver | null = null
let resizeFrame = 0

onMounted(() => {
  const viewport = viewportEl.value
  setViewportElement(viewport)
  if (!viewport || typeof ResizeObserver === "undefined")
    return
  resizeObserver = new ResizeObserver(() => {
    window.cancelAnimationFrame(resizeFrame)
    resizeFrame = window.requestAnimationFrame(handleViewportResize)
  })
  resizeObserver.observe(viewport)
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  resizeObserver = null
  setViewportElement(null)
})
</script>

<template>
  <div
    ref="viewport"
    data-slot="message-scroller-viewport"
    role="region"
    aria-label="Messages"
    :tabindex="0"
    :data-scrollable="scrollableAttr"
    :data-autoscrolling="autoscrolling ? '' : undefined"
    :class="cn(
      'size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain [overflow-anchor:none] data-autoscrolling:scrollbar-none',
      props.class,
    )"
    @scroll="syncAfterScroll()"
    @wheel="onPointerScrollIntent()"
    @touchmove="onPointerScrollIntent()"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
