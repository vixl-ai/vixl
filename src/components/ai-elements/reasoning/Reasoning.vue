<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useVModel } from '@vueuse/core'
import { computed, provide, ref, watch } from 'vue'
import { bindPersistedOpen, useChatTurnOpenState } from '@/composables/use-chat-turn-open-state'
import { ReasoningKey } from './context'

interface Props {
  class?: HTMLAttributes['class']
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  duration?: number
  persistKey?: string
}

const props = withDefaults(defineProps<Props>(), {
  isStreaming: false,
  defaultOpen: true,
  duration: undefined,
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'update:duration', value: number): void
}>()

const persistStore = useChatTurnOpenState()
const persistKey = computed(() => props.persistKey)
const persistedInitial =
  !props.isStreaming && persistKey.value
    ? persistStore?.get(persistKey.value)
    : undefined

const isOpen = useVModel(props, 'open', emit, {
  defaultValue: persistedInitial ?? props.defaultOpen,
  passive: true,
})

if (persistedInitial !== undefined) {
  isOpen.value = persistedInitial
}

const { setProgrammatic } = bindPersistedOpen(isOpen, persistKey, {
  write: () => !props.isStreaming,
})

const internalDuration = ref<number | undefined>(props.duration)
const hasAutoClosed = ref(false)
const startTime = ref<number | null>(null)
const wasStreaming = ref(false)

const MS_IN_S = 1000
const AUTO_CLOSE_DELAY = 1000

const updateDuration = (val: number): void => {
  internalDuration.value = val
  emit('update:duration', val)
}

watch(() => props.duration, (newVal) => {
  internalDuration.value = newVal
})

watch(() => props.isStreaming, (streaming, _prev, onCleanup) => {
  if (streaming) {
    wasStreaming.value = true
    setProgrammatic(true)

    if (startTime.value === null && props.duration === undefined) {
      startTime.value = Date.now()
    }
    return
  }

  if (!wasStreaming.value) {
    return
  }

  if (startTime.value !== null) {
    const calculatedDuration = Math.ceil((Date.now() - startTime.value) / MS_IN_S)
    updateDuration(calculatedDuration)
    startTime.value = null
  }

  if (!hasAutoClosed.value && isOpen.value) {
    const timer = setTimeout(() => {
      setProgrammatic(false)
      hasAutoClosed.value = true
    }, AUTO_CLOSE_DELAY)

    onCleanup(() => clearTimeout(timer))
  }
}, { immediate: true })

provide(ReasoningKey, {
  isStreaming: computed(() => props.isStreaming),
  isOpen,
  setIsOpen: (val: boolean) => { isOpen.value = val },
  duration: computed(() => internalDuration.value),
})
</script>

<template>
  <Collapsible
    v-model:open="isOpen"
    :class="cn('not-prose mb-4', props.class)"
  >
    <slot />
  </Collapsible>
</template>
