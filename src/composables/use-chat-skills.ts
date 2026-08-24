import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { vixlFileChangeToken } from '@/composables/use-vixl-live-sync'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { listUserAndProjectSkillIndex } from '@/services/skills/skill-registry'
import formatUnknownError from '@/utils/format-unknown-error'
import type { SkillIndexEntry } from '@/types/skills/skill'

export default () => {
  const fleet = useFleetRegistry()
  const skills = ref<SkillIndexEntry[]>([])
  const pending = ref(false)

  const refresh = async (): Promise<void> => {
    const project = fleet.activeProject.value
    if (!project) {
      skills.value = []
      return
    }

    pending.value = true
    try {
      skills.value = await listUserAndProjectSkillIndex(project.rootPath)
    } catch (error) {
      toast.error('Failed to load skills', {
        description: formatUnknownError(error),
      })
    } finally {
      pending.value = false
    }
  }

  watch(
    [() => fleet.activeProject.value?.id, vixlFileChangeToken],
    () => {
      refresh().catch((error) => {
        toast.error('Failed to load skills', {
          description: formatUnknownError(error),
        })
      })
    },
    { immediate: true },
  )

  return {
    skills,
    pending,
    refresh,
  }
}
