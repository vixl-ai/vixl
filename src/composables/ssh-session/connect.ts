import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import type { FleetProject } from '@/types/fleet/fleet-project'
import {
  sshCancelConnect,
  sshCancelPrompt,
  sshAnswerConfirm,
  sshConnect,
  sshPreview,
} from '@/services/vixl/vixl-tauri/ssh'
import {
  buildSshConnectRequest,
  parseSshConnectError,
  validateSshDestination,
  validateSshPort,
  validateSshUser,
} from '@/utils/ssh-destination'
import { tryParseSshProjectRoot } from '@/utils/ssh-project-root'
import { loadAliases } from './events'
import { startFolderPicker } from './folder'
import { rememberedSshIdentity, rememberSshIdentity } from './identity-memory'
import * as state from './state'

const destinationFromForm = (): string => state.connectHost.value.trim()

export const fillFromProject = (project: FleetProject): void => {
  const root = tryParseSshProjectRoot(project.rootPath)
  if (!root) {
    return
  }
  state.connectUser.value = root.user
  state.connectHost.value = root.hostname
  state.connectPort.value = String(root.port)
  state.connectIdentity.value = rememberedSshIdentity(root.user, root.hostname, root.port)
}

const rememberFormIdentity = (user: string, hostname: string, port: number): void => {
  rememberSshIdentity(user, hostname, port, state.connectIdentity.value.trim())
}

export const openAddSsh = async (): Promise<void> => {
  state.resetConnectForm()
  state.connectMode.value = 'add'
  state.connectOpen.value = true
  await loadAliases()
}

export const openReconnect = async (project: FleetProject): Promise<void> => {
  state.resetConnectForm()
  state.connectMode.value = 'reconnect'
  fillFromProject(project)
  state.connectOpen.value = true
  await loadAliases()
}

export const closeConnect = async (): Promise<void> => {
  const current = state.activePreview.value
  if (state.connectPhase.value === 'connecting' && current) {
    try {
      await sshCancelConnect(current.user, current.hostname, current.port)
    } catch {
      void 0
    }
  }
  if (state.secretEvent.value) {
    try {
      await sshCancelPrompt(state.secretEvent.value.requestId)
    } catch {
      void 0
    }
  }
  if (state.confirmEvent.value) {
    try {
      await sshAnswerConfirm(state.confirmEvent.value.requestId, false, false)
    } catch {
      void 0
    }
  }
  state.connectOpen.value = false
  state.resetConnectForm()
}

export const submitConnectForm = async (): Promise<void> => {
  const destinationError = validateSshDestination(destinationFromForm())
  if (destinationError) {
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = destinationError.title
    state.connectErrorBody.value = destinationError.body
    return
  }
  const portError = validateSshPort(state.connectPort.value)
  if (portError) {
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = portError.title
    state.connectErrorBody.value = portError.body
    return
  }
  const userError = validateSshUser(destinationFromForm(), state.connectUser.value)
  if (userError) {
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = userError.title
    state.connectErrorBody.value = userError.body
    return
  }
  state.connectPhase.value = 'connecting'
  state.connectStatus.value = 'Reading SSH config.'
  try {
    const portRaw = state.connectPort.value.trim()
    const port = portRaw ? Number(portRaw) : undefined
    const preview = await sshPreview({
      destination: destinationFromForm(),
      port,
      identityFile: state.connectIdentity.value.trim() || undefined,
    })
    const typedUser = state.connectUser.value.trim()
    const shown = typedUser ? { ...preview, user: typedUser } : preview
    state.preview.value = shown
    const previewPort = portRaw ? Number(portRaw) : shown.port
    rememberFormIdentity(shown.user, shown.hostname, previewPort)
    state.connectErrorTitle.value = ''
    state.connectErrorBody.value = ''
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = copy.title
    state.connectErrorBody.value = copy.body
    return
  }
  await confirmPreviewConnect()
}

export const confirmPreviewConnect = async (): Promise<void> => {
  const current = state.preview.value
  if (!current) {
    return
  }
  const portRaw = state.connectPort.value.trim()
  const port = portRaw ? Number(portRaw) : current.port
  const request = buildSshConnectRequest({
    destination: destinationFromForm(),
    user: state.connectUser.value.trim() || current.user,
    port,
    identityFile: state.connectIdentity.value.trim() || undefined,
    passwordOnly: state.connectPasswordOnly.value,
  })
  state.clearUserDisconnect(
    state.connectUser.value.trim() || current.user,
    current.hostname,
    port,
  )
  state.activePreview.value = current
  state.connectPhase.value = 'connecting'
  state.connectStatus.value = `Looking up ${current.hostname}.`
  state.connectPasswordOnly.value = false
  state.usedSavedSecret.value = false
  state.startElapsed()
  try {
    const status = await sshConnect(request)
    state.stopElapsed()
    state.upsertSession(status)
    state.toastedDeath.delete(state.sessionKeyOf(status.user, status.hostname, status.port))
    state.connectStatus.value = status.line
    if (status.state !== 'connected' && !status.masterAlive) {
      state.applyConnectError(
        status.lastError?.title ?? status.line,
        status.lastError?.body ?? '',
        status.hostname,
        status.port,
      )
      return
    }
    if (state.connectMode.value === 'add') {
      await startFolderPicker(status)
      return
    }
    state.connectOpen.value = false
    state.resetConnectForm()
    await refreshFleetSidebar()
  } catch (error) {
    state.stopElapsed()
    const copy = parseSshConnectError(error)
    state.applyConnectError(copy.title, copy.body, current.hostname, current.port)
  }
}

export const closeConnectError = (): void => {
  state.changedKey.value = null
  state.connectPhase.value = 'form'
  state.connectErrorTitle.value = ''
  state.connectErrorBody.value = ''
}

export const cancelConnecting = async (): Promise<void> => {
  const current = state.activePreview.value
  if (current) {
    try {
      await sshCancelConnect(current.user, current.hostname, current.port)
    } catch {
      void 0
    }
  }
  state.connectOpen.value = false
  state.resetConnectForm()
}
