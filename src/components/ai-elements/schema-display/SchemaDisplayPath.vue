<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed } from 'vue'
import { useSchemaDisplayContext } from './context'

interface Props extends /* @vue-ignore */ HTMLAttributes {
  class?: HTMLAttributes['class']
}

type PathSegment = { kind: 'text'; value: string } | { kind: 'param'; value: string }

const props = defineProps<Props>()

const { path } = useSchemaDisplayContext('SchemaDisplayPath')

const pathSegments = computed((): PathSegment[] => {
  const segments: PathSegment[] = []
  const paramPattern = /\{([^}]+)\}/g
  let lastIndex = 0
  let match = paramPattern.exec(path)

  while (match !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: path.slice(lastIndex, match.index) })
    }
    segments.push({ kind: 'param', value: match[0] })
    lastIndex = match.index + match[0].length
    match = paramPattern.exec(path)
  }

  if (lastIndex < path.length) {
    segments.push({ kind: 'text', value: path.slice(lastIndex) })
  }

  return segments
})
</script>

<template>
  <span :class="cn('font-mono text-sm', props.class)" v-bind="$attrs">
    <slot>
      <template v-for="(segment, index) in pathSegments" :key="`${segment.kind}-${index}`">
        <span v-if="segment.kind === 'param'" class="text-blue-600 dark:text-blue-400">{{
          segment.value
        }}</span>
        <template v-else>{{ segment.value }}</template>
      </template>
    </slot>
  </span>
</template>
