import { computed } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { fsListDir, registryAddProject } from '@/services/vixl/vixl-tauri'
import { sshExec, type SshSessionStatus } from '@/services/vixl/vixl-tauri/ssh'
import { parseSshConnectError } from '@/utils/ssh-destination'
import { formatSshUri, tryParseSshProjectRoot } from '@/utils/ssh-project-root'
import * as state from './state'

export const folderAbsolute = computed((): string => {
  if (!state.folderHome.value) {
    return ''
  }
  if (state.folderRelative.value === '.' || state.folderRelative.value === '') {
    return state.folderHome.value
  }
  return `${state.folderHome.value.replace(/\/$/, '')}/${state.folderRelative.value}`
})

export const listRemoteFolder = async (relative: string): Promise<void> => {
  const current = state.activePreview.value
  if (!current || !state.folderHome.value) {
    return
  }
  state.folderListing.value = true
  state.folderError.value = ''
  try {
    const homeUri = formatSshUri({
      user: current.user,
      hostname: current.hostname,
      port: current.port,
      remotePath: state.folderHome.value,
    })
    const entries = await fsListDir(homeUri, relative)
    state.folderRelative.value = relative
    state.folderEntries.value = entries.filter((entry) => entry.kind === 'directory')
  } catch (error) {
    state.folderError.value = error instanceof Error ? error.message : String(error)
  } finally {
    state.folderListing.value = false
  }
}

export const startFolderPicker = async (status: SshSessionStatus): Promise<void> => {
  state.folderListing.value = true
  state.folderError.value = ''
  try {
    const result = await sshExec({
      user: status.user,
      hostname: status.hostname,
      port: status.port,
      command: 'printf %s "$HOME"',
    })
    const home = result.stdout.trim()
    if (!home || home === '/') {
      throw new Error(`Opening / on ${status.hostname} is refused.`)
    }
    state.folderHome.value = home
    state.folderRelative.value = '.'
    state.connectPhase.value = 'pick-folder'
    await listRemoteFolder('.')
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = copy.title.startsWith('Opening /')
      ? 'Could not open project.'
      : copy.title
    state.connectErrorBody.value = copy.title.startsWith('Opening /')
      ? `Opening / on ${status.hostname} is refused.`
      : copy.body || copy.title
  } finally {
    state.folderListing.value = false
  }
}

export const enterFolder = async (path: string): Promise<void> => {
  await listRemoteFolder(path)
}

export const folderParent = (): string => {
  if (state.folderRelative.value === '.' || state.folderRelative.value === '') {
    return '.'
  }
  const parts = state.folderRelative.value.split('/')
  parts.pop()
  return parts.join('/') || '.'
}

export const registerPickedFolder = async (): Promise<void> => {
  const current = state.activePreview.value
  if (!current) {
    return
  }
  const absolute = folderAbsolute.value
  try {
    const resolved = await sshExec({
      user: current.user,
      hostname: current.hostname,
      port: current.port,
      command: `cd ${state.posixQuote(absolute)} && pwd -P`,
    })
    const realPath = resolved.stdout.trim() || absolute
    if (realPath === '/') {
      throw new Error(`Opening / on ${current.hostname} is refused.`)
    }
    const uri = formatSshUri({
      user: current.user,
      hostname: current.hostname,
      port: current.port,
      remotePath: realPath,
    })
    const fleet = useFleetRegistry()
    const existing = fleet.projects.value.find((project) => {
      const parsed = tryParseSshProjectRoot(project.rootPath)
      if (!parsed) {
        return false
      }
      return (
        parsed.user === current.user &&
        parsed.hostname === current.hostname &&
        parsed.port === current.port &&
        parsed.remotePath === realPath
      )
    })
    if (existing) {
      await fleet.setActiveProject(existing.id)
      await refreshFleetSidebar()
      toast.info('Project already added')
      state.connectOpen.value = false
      state.resetConnectForm()
      return
    }
    const name = state.folderBasename(realPath)
    await registryAddProject(name, uri)
    await fleet.refresh()
    await refreshFleetSidebar()
    toast.success('Project added')
    state.connectOpen.value = false
    state.resetConnectForm()
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.folderError.value = copy.title.startsWith('Opening /')
      ? `Opening / on ${current.hostname} is refused.`
      : copy.body || copy.title
    if (copy.title.startsWith('Opening /') || copy.body.includes('Opening /')) {
      state.connectPhase.value = 'error'
      state.connectErrorTitle.value = 'Could not open project.'
      state.connectErrorBody.value = `Opening / on ${current.hostname} is refused.`
    }
  }
}
