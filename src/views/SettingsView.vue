<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import SettingsLayout from '@/components/settings/SettingsLayout.vue'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import type { SettingsSectionId } from '@/types/settings/settings-section'
import { PERSONAL_SECTIONS } from '@/types/settings/settings-section'
import projectRouteFor from '@/utils/project-route-for'

const route = useRoute()
const router = useRouter()
const config = useVixlConfig()
const fleet = useFleetRegistry()

const resolveSection = (section: SettingsSectionId): SettingsSectionId =>
  PERSONAL_SECTIONS.includes(section) ? section : PERSONAL_SECTIONS[0]!

const activeSection = computed<SettingsSectionId>(() => {
  const section = route.query.section
  if (typeof section === 'string') {
    return resolveSection(section as SettingsSectionId)
  }
  return 'general'
})

const setSection = async (section: SettingsSectionId): Promise<void> => {
  try {
    await router.replace({
      path: '/settings',
      query: { section },
    })
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

watch(
  [() => config.hydrated.value, () => route.query.tab, () => fleet.activeProject.value],
  async ([hydrated, tabQuery, activeProject]) => {
    if (!hydrated) {
      return
    }

    if (tabQuery === 'project') {
      try {
        if (activeProject) {
          await router.replace(projectRouteFor(activeProject.slug))
        } else {
          await router.replace({
            path: '/settings',
            query: { section: activeSection.value },
          })
        }
      } catch (error) {
        toast.error('Navigation failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return
    }

    if (tabQuery === 'personal') {
      try {
        await router.replace({
          path: '/settings',
          query: { section: activeSection.value },
        })
      } catch (error) {
        toast.error('Navigation failed', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
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

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  try {
    await config.refreshAll()
  } catch (error) {
    toast.error('Failed to load settings', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div v-if="!config.hydrated.value" class="flex h-full items-center justify-center p-8">
    <p class="text-sm text-muted-foreground">Loading settings…</p>
  </div>
  <div v-else class="flex h-full min-h-0 flex-1 flex-col">
    <SettingsLayout
      :active-section="activeSection"
      @update:section="setSection"
    />
  </div>
</template>
