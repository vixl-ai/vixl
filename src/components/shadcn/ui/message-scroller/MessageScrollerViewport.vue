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
  markUserWheelScrollIntent,
  markUserScrollbarScrollIntent,
  releaseUserScrollbarScrollIntent,
  clearUserScrollbarScrollIntent,
  userScrollIntent,
} = useMessageScrollerContext()

const viewportEl = useTemplateRef<HTMLElement>("viewport")

watch(() => props.preserveScrollOnPrepend, setPreserveScrollOnPrepend, { immediate: true })

function onKeyDown(event: KeyboardEvent) {
  if (SCROLL_KEYS.has(event.key))
    userScrollIntent()
}

function onWheel() {
  // While following, do not leave on the wheel event itself. Trackpad
  // noise reports an upward delta without leaving the live edge, and the
  // next message then grows below the reader. Arm a settle window so the
  // scroll handler can exit after scrollTop is actually above the edge.
  // Inertia keeps that window alive until scroll events stop. Anchored
  // and settling jumps still treat any wheel as user intent.
  if (isFollowingLive()) {
    markUserWheelScrollIntent()
    return
  }
  userScrollIntent()
}

function onTouchMove() {
  // Touch at the live edge does not call userScrollIntent. Arm a settle
  // window so updateModeFromScroll can exit if the drag actually moved
  // scrollTop upward past the edge threshold. Inertia keeps that window
  // alive until scroll events stop. A touch that does not move scroll
  // must not leave follow.
  if (isFollowingLive()) {
    markUserTouchScrollIntent()
    return
  }
  userScrollIntent()
}

let scrollbarClearFrame = 0

function cancelPendingScrollbarClear() {
  window.cancelAnimationFrame(scrollbarClearFrame)
  scrollbarClearFrame = 0
}

function isScrollbarGutterPointer(event: PointerEvent) {
  const viewport = event.currentTarget
  if (!(viewport instanceof HTMLElement))
    return false
  // Message content is a child, so a pointerdown whose target is the
  // viewport is the scrollbar, including an overlay bar inside the
  // client box.
  return event.target === viewport
}

function onPointerDown(event: PointerEvent) {
  if (!isScrollbarGutterPointer(event))
    return
  cancelPendingScrollbarClear()
  if (!isFollowingLive())
    return
  markUserScrollbarScrollIntent()
  const viewport = event.currentTarget
  if (viewport instanceof HTMLElement)
    viewport.setPointerCapture(event.pointerId)
}

function onPointerUp() {
  // Pointer is no longer held. Keep the one-shot latch through this
  // turn so a drag that moved scrollTop can consume it. The next
  // frame drops a click that never scrolled so a later layout write
  // cannot treat it as a gesture.
  releaseUserScrollbarScrollIntent()
  cancelPendingScrollbarClear()
  scrollbarClearFrame = window.requestAnimationFrame(() => {
    scrollbarClearFrame = 0
    clearUserScrollbarScrollIntent()
  })
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
  cancelPendingScrollbarClear()
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
      'size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain [overflow-anchor:none]',
      props.class,
    )"
    @scroll="syncAfterScroll()"
    @wheel="onWheel"
    @pointerdown="onPointerDown"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @lostpointercapture="onPointerUp"
    @touchmove="onTouchMove"
    @keydown="onKeyDown"
  >
    <slot />
  </div>
</template>
