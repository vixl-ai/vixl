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
  markUserTouchScrollIntent,
  userScrollIntent,
} = useMessageScrollerContext()

const viewportEl = useTemplateRef<HTMLElement>("viewport")

watch(() => props.preserveScrollOnPrepend, setPreserveScrollOnPrepend, { immediate: true })

function onKeyDown(event: KeyboardEvent) {
  if (SCROLL_KEYS.has(event.key))
    userScrollIntent()
}

function onWheel(event: WheelEvent) {
  // Upward wheel (deltaY < 0, toward older messages) leaves follow
  // immediately, even during autoscroll. Downward or zero deltaY must
  // not: trackpad noise at the live edge would drop a live turn.
  // Anchored and settling jumps still treat any wheel as user intent.
  if (isFollowingLive()) {
    if (event.deltaY < 0)
      userScrollIntent()
    return
  }
  userScrollIntent()
}

function onTouchMove() {
  // Touch at the live edge does not call userScrollIntent. Arm a one-shot
  // flag so updateModeFromScroll can exit if the drag actually moved
  // scrollTop upward past the edge threshold. A touch that does not
  // move scroll must not leave follow.
  if (isFollowingLive()) {
    markUserTouchScrollIntent()
    return
  }
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
    @wheel="onWheel"
    @touchmove="onTouchMove"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
