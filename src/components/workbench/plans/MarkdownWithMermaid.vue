<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { PreprocessSteps } from '@markmend/core'
import { Markdown, type PreviewerConfig } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { cn } from '@/lib/utils'
import safeFixEmphasis from '@/utils/markdown/safe-fix-emphasis'
import { splitPlanBodySegments } from '@/utils/plans'

interface Props {
  content: string
  streaming?: boolean
  class?: HTMLAttributes['class']
}

// Library allows mermaid?: boolean, but also intersects Record<string, Component>.
const mermaidPreviewers = {
  components: {
    mermaid: false,
  },
} as PreviewerConfig

const preprocessSteps: PreprocessSteps = { emphasis: safeFixEmphasis }

const props = withDefaults(defineProps<Props>(), {
  streaming: false,
})

const segments = computed(() => splitPlanBodySegments(props.content))
const markdownMode = computed(() => (props.streaming ? 'streaming' : 'static'))
</script>

<template>
  <div :class="cn('min-w-0 max-w-full', props.class)">
    <template v-for="(segment, index) in segments" :key="index">
      <Markdown
        v-if="segment.type === 'markdown' && segment.content.trim()"
        :content="segment.content"
        :mode="markdownMode"
        :enable-animate="streaming"
        :previewers="mermaidPreviewers"
        :preprocess-steps="preprocessSteps"
      />
      <PlanMermaid
        v-else-if="segment.type === 'mermaid'"
        :code="segment.content"
      />
    </template>
  </div>
</template>
