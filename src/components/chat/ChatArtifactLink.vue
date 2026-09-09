<script setup lang="ts">
import { computed } from 'vue'
import { AppIcon } from '@/icons'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import type { ChatArtifact } from '@/types/chat/chat-artifact'
import { Button } from '@/components/shadcn/ui/button'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { HOME_WORKSPACE_ID, isHomeChatSlug } from '@/constants/home-chat'
import openAtLine from '@/utils/open-at-line'

const props = defineProps<{
  artifact: ChatArtifact
}>()

const route = useRoute()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()

const projectId = computed(() => {
  const slug = String(route.params.slug ?? '')
  const standalone =
    route.name === 'home-chat' || route.name === 'home-chat-subagent' || isHomeChatSlug(slug)
  if (standalone) {
    return HOME_WORKSPACE_ID
  }
  const project = fleet.projects.value.find((item) => item.slug === slug)
  return project?.id ?? fleet.activeProjectId.value
})

const lineSuffix = computed(() => {
  const start = props.artifact.startLine
  if (typeof start !== 'number' || start < 1) {
    return ''
  }
  const end = props.artifact.endLine
  if (typeof end === 'number' && end > start) {
    return `:${start}-${end}`
  }
  return `:${start}`
})

const displayLabel = computed(() => {
  if (props.artifact.label) {
    return props.artifact.label
  }
  if (props.artifact.kind === 'plan') {
    const match = props.artifact.path.match(/^\.vixl\/plans\/([^/]+)\//)
    if (match?.[1]) {
      return match[1]
    }
  }
  const segments = props.artifact.path.split('/')
  const base = segments[segments.length - 1] ?? props.artifact.path
  return `${base}${lineSuffix.value}`
})

const icon = computed(() => {
  if (props.artifact.kind === 'plan') {
    return 'file-text'
  }
  return 'file-code'
})

const handleOpen = async (event: MouseEvent): Promise<void> => {
  event.preventDefault()
  event.stopPropagation()

  const id = projectId.value
  if (!id) {
    toast.error('Project not found', {
      description: 'Could not resolve the active project for this chat.',
    })
    return
  }

  try {
    if (props.artifact.kind === 'plan') {
      const planId =
        props.artifact.path.match(/^\.vixl\/plans\/([^/]+)\//)?.[1] ?? displayLabel.value
      await workbench.openPlan(id, planId, props.artifact.path, props.artifact.label)
      return
    }

    await openAtLine(id, props.artifact.path, props.artifact.startLine)
  } catch (error) {
    toast.error('Failed to open artifact', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Button
    type="button"
    variant="link"
    size="xs"
    class="h-auto max-w-[18rem] shrink-0 px-0 py-0 text-xs font-normal"
    @click="handleOpen"
  >
    <AppIcon :name="icon" class="size-3 shrink-0" />
    <span class="truncate">{{ displayLabel }}</span>
  </Button>
</template>
