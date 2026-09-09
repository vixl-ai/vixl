<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  provider: string
  class?: HTMLAttributes['class']
}

const props = defineProps<Props>()

const failed = ref(false)

/** models.dev "gateway" mark is a 4-spark glyph that reads as tildes; use Vercel. */
const logoId = computed(() => (props.provider === 'gateway' ? 'vercel' : props.provider))

const handleLogoError = (): void => {
  failed.value = true
}

watch(logoId, () => {
  failed.value = false
})
</script>

<template>
  <img
    v-if="!failed"
    v-bind="$attrs"
    :alt="`${props.provider} logo`"
    :class="cn('size-3 dark:invert', props.class)"
    height="12"
    :src="`https://models.dev/logos/${logoId}.svg`"
    width="12"
    @error="handleLogoError"
  />
</template>
