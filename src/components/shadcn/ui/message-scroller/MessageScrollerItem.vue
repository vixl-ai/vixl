<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { computed, onBeforeUnmount, onMounted, useTemplateRef, watch } from "vue"
import { cn } from "@/lib/utils"
import { useMessageScrollerContext, useMessageScrollerRegister } from "./useMessageScroller"

const props = withDefaults(defineProps<{
  messageId?: string
  scrollAnchor?: boolean
  placeholderHeight?: number
  class?: HTMLAttributes["class"]
}>(), {
  scrollAnchor: false,
})

const register = useMessageScrollerRegister()
const { reportItemHeight } = useMessageScrollerContext()

const itemEl = useTemplateRef<HTMLElement>("item")
const isPlaceholder = computed(() => typeof props.placeholderHeight === "number")

let resizeObserver: ResizeObserver | null = null

function reportHeight() {
  const element = itemEl.value
  if (!element || !props.messageId || isPlaceholder.value)
    return
  const height = element.getBoundingClientRect().height
  if (height >= 1)
    reportItemHeight(props.messageId, height)
}

function stopObserving() {
  resizeObserver?.disconnect()
  resizeObserver = null
}

function startObserving() {
  stopObserving()
  const element = itemEl.value
  if (!element || isPlaceholder.value || typeof ResizeObserver === "undefined")
    return
  resizeObserver = new ResizeObserver(() => reportHeight())
  resizeObserver.observe(element)
  reportHeight()
}

onMounted(() => {
  if (props.messageId && itemEl.value)
    register(props.messageId, itemEl.value, null)
  startObserving()
})

watch(() => props.messageId, (messageId, previousMessageId) => {
  const element = itemEl.value
  if (!element)
    return
  if (previousMessageId)
    register(previousMessageId, null, element)
  if (messageId)
    register(messageId, element, null)
  reportHeight()
})

watch(isPlaceholder, (placeholder) => {
  if (placeholder)
    stopObserving()
  else
    startObserving()
})

onBeforeUnmount(() => {
  stopObserving()
  if (props.messageId && itemEl.value)
    register(props.messageId, null, itemEl.value)
})
</script>

<template>
  <div
    ref="item"
    data-slot="message-scroller-item"
    :data-message-id="messageId"
    :data-scroll-anchor="scrollAnchor ? 'true' : 'false'"
    :data-window-placeholder="isPlaceholder ? 'true' : undefined"
    :style="isPlaceholder ? { height: `${placeholderHeight}px` } : undefined"
    :class="cn(
      'min-w-0 shrink-0',
      props.class,
    )"
  >
    <slot v-if="!isPlaceholder" />
  </div>
</template>
