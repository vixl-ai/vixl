<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed } from 'vue'
import { cn } from '@/lib/utils'
import resolveFileIcon from '@/utils/resolve-file-icon'

const props = defineProps<{
  name: string
  isDirectory?: boolean
  isOpen?: boolean
  class?: HTMLAttributes['class']
}>()

const icon = computed(() =>
  resolveFileIcon(props.name, {
    isDirectory: props.isDirectory ?? false,
    isOpen: props.isOpen ?? false,
  }),
)
</script>

<template>
  <img
    v-if="icon"
    :src="icon.src"
    alt=""
    width="16"
    height="16"
    :class="cn('block size-4 shrink-0 object-contain', props.class)"
    draggable="false"
  />
</template>
