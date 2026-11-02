import { computed, type ComputedRef } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useSshSession from '@/composables/use-ssh-session'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import { isSshProjectRoot } from '@/utils/ssh-project-root'

type RowWorkspace = {
  activateId: string
} | null

export default (
  project: ComputedRef<FleetSidebarProject>,
  isGroup: ComputedRef<boolean>,
  resolveRowWorkspace: () => RowWorkspace,
) => {
  const fleet = useFleetRegistry()
  const ssh = useSshSession()
  const sshRootPath = computed(() => (isGroup.value ? null : project.value.rootPath ?? null))
  const isSshProject = computed(() => isSshProjectRoot(sshRootPath.value))
  const sshStatus = computed(() =>
    isSshProject.value ? ssh.sessionForRoot(sshRootPath.value) : null,
  )
  const sshStatusLine = computed((): string | null => {
    if (!isSshProject.value) {
      return null
    }
    return sshStatus.value?.line || `Disconnected from ${sshStatus.value?.hostname ?? 'host'}.`
  })

  const projectForActions = () => {
    const workspace = resolveRowWorkspace()
    return workspace
      ? fleet.projects.value.find((entry) => entry.id === workspace.activateId)
      : fleet.projects.value.find((entry) => entry.slug === project.value.slug)
  }

  const handleReconnect = async (): Promise<void> => {
    const target = projectForActions()
    if (!target) {
      toast.error('Project not found')
      return
    }
    await ssh.openReconnect(target)
  }

  const handleDisconnect = (): void => {
    const target = projectForActions()
    if (!target) {
      toast.error('Project not found')
      return
    }
    ssh.requestDisconnect(target)
  }

  const handleForwardPort = (): void => {
    const target = projectForActions()
    if (!target) {
      toast.error('Project not found')
      return
    }
    ssh.openPortForward(target)
  }

  return {
    isSshProject,
    sshStatusLine,
    handleReconnect,
    handleDisconnect,
    handleForwardPort,
  }
}
