<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { toast } from 'vue-sonner'
import StudioRenderer from '@/components/studio/StudioRenderer.vue'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/ui/alert'
import isStudioHtmlContent from '@/services/studio/is-studio-html-content'
import parseStudioArtifact from '@/services/studio/parse-studio-artifact'
import { fsReadFile } from '@/services/vixl/vixl-tauri'

const props = defineProps<{
  path: string
  projectRoot: string | null
  content: string
}>()

const studioData = ref<Record<string, unknown>>({})
const studioParseError = ref<string | null>(null)

const isStudioPath = computed(() => props.path.startsWith('.vixl/studio/'))

const studioRenderMarkdown = computed(() => {
  if (!isStudioPath.value || studioParseError.value) {
    return ''
  }
  return parseStudioArtifact(props.content).body
})

const dataJsonPathFor = (artifactPath: string): string => {
  const base = artifactPath.replace(/\/index\.md$/, '')
  return `${base}/data.json`
}

const syncStudioParseError = (): void => {
  if (!isStudioPath.value) {
    studioParseError.value = null
    return
  }
  if (isStudioHtmlContent(props.content)) {
    studioParseError.value =
      'This artifact uses unsupported HTML. Regenerate with Comark blocks via load_skill("studio-blocks").'
    return
  }
  studioParseError.value = null
}

const loadStudioData = async (): Promise<void> => {
  const root = props.projectRoot
  if (!root || !isStudioPath.value) {
    studioData.value = {}
    return
  }

  try {
    const sidecar = await fsReadFile({ projectRoot: root, path: dataJsonPathFor(props.path) })
    studioData.value = JSON.parse(sidecar.content) as Record<string, unknown>
  } catch {
    studioData.value = {}
  }
}

watch(
  () => props.content,
  () => {
    syncStudioParseError()
  },
  { immediate: true },
)

watch(
  [() => props.path, () => props.projectRoot, isStudioPath],
  () => {
    syncStudioParseError()
    if (!isStudioPath.value) {
      studioData.value = {}
      return
    }
    loadStudioData().catch((error) => {
      toast.error('Failed to load studio data', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="h-full min-h-0 overflow-y-auto">
    <template v-if="isStudioPath">
      <Alert v-if="studioParseError" variant="destructive" class="m-4">
        <AlertTitle>Unsupported studio artifact</AlertTitle>
        <AlertDescription>{{ studioParseError }}</AlertDescription>
      </Alert>
      <div v-else class="px-4 py-3">
        <StudioRenderer :markdown="studioRenderMarkdown" :data="studioData" />
      </div>
    </template>
    <div v-else class="px-4 py-3 text-sm">
      <Markdown
        v-if="content.trim()"
        :content="content"
        :enable-animate="false"
      />
    </div>
  </div>
</template>
