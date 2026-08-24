import { ref } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { openFolderPicker, registryAddProject } from '@/services/vixl/vixl-tauri'

const folderBasename = (rootPath: string): string => {
  const trimmed = rootPath.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  return segments[segments.length - 1] || 'project'
}

export default () => {
  const fleet = useFleetRegistry()
  const addingProject = ref(false)

  const addProjectFromPicker = async (): Promise<void> => {
    if (addingProject.value) {
      return
    }

    addingProject.value = true
    try {
      const rootPath = await openFolderPicker()
      if (!rootPath) {
        return
      }

      const existing = fleet.projects.value.find((project) => project.rootPath === rootPath)
      if (existing) {
        await fleet.setActiveProject(existing.id)
        await refreshFleetSidebar()
        toast.info('Project already added')
        return
      }

      const name = folderBasename(rootPath)
      await registryAddProject(name, rootPath)
      await fleet.refresh()
      await refreshFleetSidebar()
      toast.success('Project added')
    } catch (error) {
      toast.error('Could not add project', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      addingProject.value = false
    }
  }

  return {
    addingProject,
    addProjectFromPicker,
  }
}
