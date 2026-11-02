import { sshExec, type SshSessionStatus } from '@/services/vixl/vixl-tauri/ssh'
import { parseSshConnectError } from '@/utils/ssh-destination'
import { listAt } from './folder'
import * as state from './state'

export const startFolderPicker = async (status: SshSessionStatus): Promise<void> => {
  const attempt = state.connectAttempt.value
  state.folderListing.value = true
  state.folderError.value = ''
  try {
    const result = await sshExec({
      user: status.user,
      hostname: status.hostname,
      port: status.port,
      command: 'printf %s "$HOME"',
    })
    if (attempt !== state.connectAttempt.value) {
      return
    }
    const home = result.stdout.trim()
    if (!home || home === '/') {
      throw new Error(`Opening / on ${status.hostname} is refused.`)
    }
    state.folderHome.value = home
    state.folderCurrent.value = home
    state.folderRelative.value = '.'
    state.connectPhase.value = 'pick-folder'
    await listAt(home, attempt)
  } catch (error) {
    if (attempt !== state.connectAttempt.value) {
      return
    }
    const copy = parseSshConnectError(error)
    state.connectPhase.value = 'error'
    state.connectErrorTitle.value = copy.title.startsWith('Opening /')
      ? 'Could not open project.'
      : copy.title
    state.connectErrorBody.value = copy.title.startsWith('Opening /')
      ? `Opening / on ${status.hostname} is refused.`
      : copy.body || copy.title
  } finally {
    if (attempt === state.connectAttempt.value) {
      state.folderListing.value = false
    }
  }
}
