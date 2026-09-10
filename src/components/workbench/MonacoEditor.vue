<script setup lang="ts">
import useMonacoEditor from '@/composables/monaco-editor'

const props = defineProps<{
  projectId: string
  path: string | null
  openPaths?: string[]
  lineNumbers?: boolean
  wordWrap?: boolean
  diffView?: boolean
}>()

const emit = defineEmits<{
  'dirty-change': [payload: { path: string; dirty: boolean }]
  saved: [payload: { path: string; content: string }]
}>()

const { containerRef, save, isPathDirty } = useMonacoEditor(props, emit)

defineExpose({
  save,
  isPathDirty,
})
</script>

<template>
  <div
    ref="containerRef"
    class="h-full min-h-0 w-full overflow-hidden bg-background"
  />
</template>
