<script setup lang="ts">
import type { FleetProject } from '@/types/fleet/fleet-project'
import WorkbenchFileTree from '@/components/workbench/WorkbenchFileTree.vue'

const props = defineProps<{
  members: FleetProject[]
  selectedProjectId: string
  selectedPath?: string | null
}>()

const emit = defineEmits<{
  select: [path: string, projectId: string]
  'tree-changed': []
}>()

type MemberTreeExpose = {
  handleNewFile: (parentDirPath?: string) => void
  handleNewFolder: (parentDirPath?: string) => void
  refresh: () => Promise<void>
}

const treeRefs = ref<Record<string, MemberTreeExpose | null>>({})

const setTreeRef = (projectId: string, instance: unknown): void => {
  if (instance && typeof instance === 'object' && 'handleNewFile' in instance) {
    treeRefs.value[projectId] = instance as MemberTreeExpose
    return
  }
  treeRefs.value[projectId] = null
}

const primaryId = computed(() => props.members[0]?.id)

const handleNewFile = (parentDirPath?: string): void => {
  const id = primaryId.value
  if (!id) {
    return
  }
  treeRefs.value[id]?.handleNewFile(parentDirPath)
}

const handleNewFolder = (parentDirPath?: string): void => {
  const id = primaryId.value
  if (!id) {
    return
  }
  treeRefs.value[id]?.handleNewFolder(parentDirPath)
}

const handleSelect = (path: string, projectId: string): void => {
  emit('select', path, projectId)
}

const handleTreeChanged = (): void => {
  emit('tree-changed')
}

defineExpose({
  handleNewFile,
  handleNewFolder,
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden font-sans text-[13px]">
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <WorkbenchFileTree
        v-for="member in members"
        :key="member.id"
        :ref="(el) => setTreeRef(member.id, el)"
        :project-id="member.id"
        :selected-path="selectedProjectId === member.id ? selectedPath : null"
        :show-toolbar="false"
        hide-chrome
        embedded
        :root-node-name="member.slug"
        @select="handleSelect($event, member.id)"
        @tree-changed="handleTreeChanged"
      />
    </div>
  </div>
</template>
