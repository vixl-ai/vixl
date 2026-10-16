<script setup lang="ts">
import { computed } from 'vue'
import ProjectNav from '@/components/project/ProjectNav.vue'
import ProjectChatsSection from '@/components/project/sections/ChatsSection.vue'
import ProjectCodeGraphSection from '@/components/project/sections/CodeGraphSection.vue'
import McpServersSection from '@/components/settings/sections/McpServersSection.vue'
import PlansSection from '@/components/settings/sections/PlansSection.vue'
import SkillsSection from '@/components/settings/sections/SkillsSection.vue'
import AgentsSection from '@/components/settings/sections/AgentsSection.vue'
import RulesSection from '@/components/settings/sections/RulesSection.vue'
import type { ProjectSectionId } from '@/types/project/project-section'

const props = defineProps<{
  projectName: string
  projectSlug: string
  activeSection: ProjectSectionId
  memberNames?: string[]
}>()

const emit = defineEmits<{
  'update:section': [ProjectSectionId]
}>()

const sectionComponent = computed(() => {
  switch (props.activeSection) {
    case 'chats':
      return ProjectChatsSection
    case 'mcp':
      return McpServersSection
    case 'codegraph':
      return ProjectCodeGraphSection
    case 'plans':
      return PlansSection
    case 'skills':
      return SkillsSection
    case 'agents':
      return AgentsSection
    case 'rules':
      return RulesSection
    default:
      return ProjectChatsSection
  }
})

const sectionProps = computed(() => {
  if (props.activeSection === 'chats') {
    return { projectSlug: props.projectSlug }
  }
  if (props.activeSection === 'codegraph') {
    return { projectSlug: props.projectSlug }
  }
  return { tab: 'project' as const }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-hidden p-6">
    <div class="flex items-center justify-between">
      <div class="min-w-0">
        <h1 class="truncate text-2xl font-semibold tracking-tight" :title="projectName">
          {{ projectName }}
        </h1>
        <p
          v-if="memberNames && memberNames.length > 0"
          class="mt-1 truncate text-sm text-muted-foreground"
          :title="memberNames.join(', ')"
        >
          Members: {{ memberNames.join(', ') }}
        </p>
      </div>
    </div>

    <ProjectNav
      :active-section="activeSection"
      @select="emit('update:section', $event)"
    />

    <div class="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <component
        :is="sectionComponent"
        class="flex min-h-0 flex-1 flex-col"
        v-bind="sectionProps"
      />
    </div>
  </div>
</template>
