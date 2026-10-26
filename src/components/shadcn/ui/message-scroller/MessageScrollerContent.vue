<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { onBeforeUnmount, onMounted, useTemplateRef } from "vue"
import { cn } from "@/lib/utils"
import { observeContentBoxResize } from "./observe-content-box-resize"
import { useMessageScrollerContext } from "./useMessageScroller"

const props = defineProps<{
  class?: HTMLAttributes["class"]
  spacerClass?: HTMLAttributes["class"]
}>()

const {
  handleContentChange,
  handleContentResize,
  setContentElement,
  setSpacerElement,
} = useMessageScrollerContext()

const contentRef = useTemplateRef<HTMLElement>("content")
const spacerRef = useTemplateRef<HTMLElement>("spacer")

let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const content = contentRef.value
  if (!content)
    return

  setContentElement(content)
  setSpacerElement(spacerRef.value ?? null)
  handleContentChange()

  if (typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(() => handleContentChange())
    mutationObserver.observe(content, { childList: true })
  }

  resizeObserver = observeContentBoxResize(content, handleContentResize)
})

onBeforeUnmount(() => {
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  mutationObserver = null
  resizeObserver = null
  setContentElement(null)
  setSpacerElement(null)
})
</script>

<template>
  <div
    ref="content"
    data-slot="message-scroller-content"
    role="log"
    aria-relevant="additions"
    :class="cn('flex h-max min-h-full flex-col gap-8', props.class)"
  >
    <slot />
    <div
      ref="spacer"
      aria-hidden="true"
      data-message-scroller-spacer=""
      hidden
      :class="props.spacerClass"
    />
  </div>
</template>
