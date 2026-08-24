<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import ProjectLayout from '@/components/project/ProjectLayout.vue'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import {
  PROJECT_SECTIONS,
  type ProjectSectionId,
} from '@/types/project/project-section'
import projectRouteFor from '@/utils/project-route-for'

const route = useRoute()
const router = useRouter()
const fleet = useFleetRegistry()
const config = useVixlConfig()
const activating = ref(false)

const projectSlug = computed(() => String(route.params.slug ?? ''))

const project = computed(
  () => fleet.projects.value.find((item) => item.slug === projectSlug.value) ?? null,
)

const resolveSection = (section: string | undefined): ProjectSectionId => {
  if (typeof section === 'string' && PROJECT_SECTIONS.includes(section as ProjectSectionId)) {
    return section as ProjectSectionId
  }
  return PROJECT_SECTIONS[0]!
}

const activeSection = computed(() =>
  resolveSection(
    typeof route.query.section === 'string' ? route.query.section : undefined,
  ),
)

const setSection = async (section: ProjectSectionId): Promise<void> => {
  try {
    await router.replace(projectRouteFor(projectSlug.value, section))
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const activateProject = async (): Promise<void> => {
  const target = project.value
  if (!target) {
    return
  }
  if (fleet.activeProjectId.value === target.id) {
    return
  }
  if (activating.value) {
    return
  }

  activating.value = true
  try {
    await fleet.setActiveProject(target.id)
    await config.refreshAll()
  } catch (error) {
    toast.error('Could not open project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    activating.value = false
  }
}

watch(
  [project, () => fleet.loaded.value],
  async ([nextProject, loaded]) => {
    if (!loaded) {
      return
    }
    if (!nextProject) {
      toast.error('Project not found')
      try {
        await router.push('/')
      } catch (error) {
        toast.error('Navigation failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return
    }
    await activateProject()
  },
  { immediate: true },
)

const onKeydown = async (event: KeyboardEvent): Promise<void> => {
  if (event.key === 'Escape') {
    try {
      await router.push('/')
    } catch (error) {
      toast.error('Navigation failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div
    v-if="!fleet.loaded.value || !project"
    class="flex h-full items-center justify-center p-8"
  >
    <p class="text-sm text-muted-foreground">Loading project…</p>
  </div>
  <div v-else class="flex h-full min-h-0 flex-1 flex-col">
    <ProjectLayout
      :project-name="project.name"
      :project-slug="project.slug"
      :active-section="activeSection"
      @update:section="setSection"
    />
  </div>
</template>
