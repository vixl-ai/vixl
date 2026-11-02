import { computed } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import { fsListDir, fsMkdir, registryAddProject } from '@/services/vixl/vixl-tauri'
import { sshExec, type SshSessionStatus } from '@/services/vixl/vixl-tauri/ssh'
import { parseSshConnectError } from '@/utils/ssh-destination'
import { formatSshUri, tryParseSshProjectRoot } from '@/utils/ssh-project-root'
import * as state from './state'

export const folderAbsolute = computed((): string => state.folderCurrent.value)

export const folderCrumbs = computed((): { label: string; path: string }[] => {
  const parts = state.folderCurrent.value.split('/').filter(Boolean)
  return parts.map((label, index) => ({
    label,
    path: `/${parts.slice(0, index + 1).join('/')}`,
  }))
})

const listingUri = (absolute: string) => {
  const current = state.activePreview.value
  if (!current) {
    return null
  }
  return formatSshUri({
    user: current.user,
    hostname: current.hostname,
    port: current.port,
    remotePath: absolute,
  })
}

export const listAt = async (absolute: string): Promise<void> => {
  const current = state.activePreview.value
  if (!current) {
    return
  }
  const path = absolute.replace(/\/+$/, '') || '/'
  if (path === '/') {
    state.folderError.value = `Opening / on ${current.hostname} is refused.`
    return
  }
  const uri = listingUri(path)
  if (!uri) {
    return
  }
  state.folderListing.value = true
  state.folderError.value = ''
  try {
    const entries = await fsListDir(uri, '.')
    state.folderCurrent.value = path
    state.folderRelative.value = '.'
    state.folderEntries.value = entries.filter((entry) => entry.kind === 'directory')
    state.folderSelected.value = []
  } catch (error) {
    state.folderError.value = error instanceof Error ? error.message : String(error)
  } finally {
    state.folderListing.value = false
  }
}

export const listRemoteFolder = async (relative: string): Promise<void> => {
  if (relative.startsWith('/')) {
    await listAt(relative)
    return
  }
  const base = state.folderCurrent.value.replace(/\/$/, '')
  if (!base) {
    return
  }
  if (relative === '.' || relative === '') {
    await listAt(base)
    return
  }
  await listAt(`${base}/${relative}`)
}

export const folderChildPath = (name: string): string => {
  const base = state.folderCurrent.value.replace(/\/$/, '')
  return `${base}/${name}`
}

export const setFolderSelected = (absolute: string, selected: boolean): void => {
  const current = state.folderSelected.value
  const has = current.includes(absolute)
  if (selected && !has) {
    state.folderSelected.value = [...current, absolute]
  } else if (!selected && has) {
    state.folderSelected.value = current.filter((path) => path !== absolute)
  }
}

const rejectedFolderName = (name: string, hostname: string): string | null => {
  const trimmed = name.trim()
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\0\n\r]/.test(trimmed)) {
    return `Name rejected on ${hostname}.`
  }
  return null
}

export const createRemoteFolder = async (name: string): Promise<void> => {
  const current = state.activePreview.value
  const parent = state.folderCurrent.value
  if (!current || !parent) {
    return
  }
  const rejected = rejectedFolderName(name, current.hostname)
  if (rejected) {
    state.folderError.value = rejected
    return
  }
  const uri = listingUri(parent)
  if (!uri) {
    return
  }
  state.folderListing.value = true
  state.folderError.value = ''
  try {
    await fsMkdir({ projectRoot: uri, path: name.trim() })
    await listAt(parent)
    if (!state.folderError.value) {
      state.folderSelected.value = [folderChildPath(name.trim())]
    }
  } catch (error) {
    state.folderError.value = error instanceof Error ? error.message : String(error)
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
    state.folderCurrent.value = home
    state.folderRelative.value = '.'
    state.connectPhase.value = 'pick-folder'
    await listAt(home)
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
  const current = state.folderCurrent.value.replace(/\/$/, '')
  const slash = current.lastIndexOf('/')
  if (slash <= 0) {
    return '/'
  }
  return current.slice(0, slash)
}

const resolveRealPath = async (absolute: string): Promise<string> => {
  const current = state.activePreview.value
  if (!current) {
    throw new Error('SSH session is not connected.')
  }
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
  return realPath
}

const sameRemoteProject = (
  rootPath: string,
  user: string,
  hostname: string,
  port: number,
  realPath: string,
): boolean => {
  const parsed = tryParseSshProjectRoot(rootPath)
  if (!parsed) {
    return false
  }
  return (
    parsed.user === user &&
    parsed.hostname === hostname &&
    parsed.port === port &&
    parsed.remotePath === realPath
  )
}

export const registerPickedFolder = async (): Promise<void> => {
  const current = state.activePreview.value
  if (!current) {
    return
  }
  if (state.folderSelected.value.length < 1) {
    return
  }
  const targets = [...state.folderSelected.value]
  const fleet = useFleetRegistry()
  let added = 0
  let existing = 0
  let lastRealPath: string | null = null
  try {
    for (const absolute of targets) {
      const realPath = await resolveRealPath(absolute)
      const match = fleet.projects.value.find((project) =>
        sameRemoteProject(project.rootPath, current.user, current.hostname, current.port, realPath),
      )
      if (match) {
        existing += 1
        lastRealPath = realPath
        continue
      }
      const uri = formatSshUri({
        user: current.user,
        hostname: current.hostname,
        port: current.port,
        remotePath: realPath,
      })
      await registryAddProject(state.folderBasename(realPath), uri)
      added += 1
      lastRealPath = realPath
    }
    await fleet.refresh()
    const chosen = lastRealPath
    if (chosen) {
      const active = fleet.projects.value.find((project) =>
        sameRemoteProject(
          project.rootPath,
          current.user,
          current.hostname,
          current.port,
          chosen,
        ),
      )
      if (active) {
        await fleet.setActiveProject(active.id)
      }
    }
    await refreshFleetSidebar()
    if (added === 0) {
      toast.info(existing === 1 ? 'Project already added' : `${existing} projects already added`)
    } else if (added === 1 && existing === 0) {
      toast.success('Project added')
    } else if (existing === 0) {
      toast.success(`Added ${added} projects`)
    } else {
      toast.success(`Added ${added} projects. ${existing} already added.`)
    }
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
    if (added > 0) {
      await fleet.refresh()
      await refreshFleetSidebar()
    }
  }
}
