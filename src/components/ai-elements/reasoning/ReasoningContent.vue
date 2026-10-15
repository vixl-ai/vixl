<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { CollapsibleContent } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { nextRevealedReasoning } from '@/utils/next-revealed-reasoning'
import { computed, onUnmounted, ref, watch } from 'vue'

interface Props {
  class?: HTMLAttributes['class']
  content: string
  /** When true, reveal appended reasoning on animation frames. */
  streaming?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  streaming: false,
})

const revealed = ref(props.streaming ? '' : props.content)
let frameId = 0

const stopReveal = (): void => {
  if (frameId === 0) {
    return
  }
  window.cancelAnimationFrame(frameId)
  frameId = 0
}

const tickReveal = (): void => {
  frameId = 0
  if (!props.streaming) {
    revealed.value = props.content
    return
  }
  const next = nextRevealedReasoning(revealed.value, props.content)
  revealed.value = next
  if (next !== props.content) {
    frameId = window.requestAnimationFrame(tickReveal)
  }
}

watch(
  () => [props.content, props.streaming] as const,
  ([content, streaming]) => {
    if (!streaming) {
      stopReveal()
      revealed.value = content
      return
    }
    if (revealed.value === content) {
      stopReveal()
      return
    }
    if (frameId === 0) {
      frameId = window.requestAnimationFrame(tickReveal)
    }
  },
  { immediate: true },
)

onUnmounted(stopReveal)

const md = computed(() => revealed.value)
</script>

<template>
  <CollapsibleContent
    :class="cn(
      'mt-1.5 border-l border-border/70 pl-3 text-xs leading-relaxed text-muted-foreground',
      'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2',
      'data-[state=open]:slide-in-from-top-2',
      'outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
      props.class,
    )"
  >
    <MarkdownWithMermaid
      v-if="md"
      :content="md"
      :streaming="streaming"
      class="min-w-0 max-w-full overflow-hidden text-muted-foreground **:text-muted-foreground [&_p]:my-1.5 [&_p]:leading-relaxed [&_strong]:font-medium [&_strong]:text-muted-foreground"
    />
    <slot />
  </CollapsibleContent>
</template>
