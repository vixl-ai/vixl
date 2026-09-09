<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { AppIcon } from '@/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { computed, ref } from 'vue'
import { useEnvironmentVariableContext } from './context'

type ButtonProps = InstanceType<typeof Button>['$props']

interface Props extends /* @vue-ignore */ ButtonProps {
  timeout?: number
  copyFormat?: 'name' | 'value' | 'export'
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  timeout: 2000,
  copyFormat: 'value',
})

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'error', error: Error): void
}>()

const isCopied = ref(false)
const { name, value } = useEnvironmentVariableContext()

async function copyToClipboard() {
  if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
    const error = new Error('Clipboard API not available')
    emit('error', error)
    return
  }

  let textToCopy = value
  if (props.copyFormat === 'name') {
    textToCopy = name
  } else if (props.copyFormat === 'export') {
    textToCopy = `export ${name}="${value}"`
  }

  try {
    await navigator.clipboard.writeText(textToCopy)
    isCopied.value = true
    emit('copy')
    setTimeout(() => {
      isCopied.value = false
    }, props.timeout)
  } catch (error) {
    const err = error as Error
    emit('error', err)
  }
}
</script>

<template>
  <Button
    :class="cn('size-6 shrink-0', props.class)"
    size="icon"
    variant="ghost"
    v-bind="$attrs"
    @click="copyToClipboard"
  >
    <slot>
      <AppIcon :name="isCopied ? 'check' : 'copy'" :size="12" />
    </slot>
  </Button>
</template>
