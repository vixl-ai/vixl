import { computed } from 'vue'
import { toast } from 'vue-sonner'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { sshDisconnect, sshOpenLocalForward, type SshSessionStatus } from '@/services/vixl/vixl-tauri/ssh'
import type { FleetProject } from '@/types/fleet/fleet-project'
import { isSshProjectRoot, tryParseSshProjectRoot, type SshProjectRoot } from '@/utils/ssh-project-root'
import * as state from './state'

const sharedProjectCount = (root: SshProjectRoot): number => {
  const fleet = useFleetRegistry()
  return fleet.projects.value.filter((project) => {
    const parsed = tryParseSshProjectRoot(project.rootPath)
    return (
      parsed !== null &&
      parsed.user === root.user &&
      parsed.hostname === root.hostname &&
      parsed.port === root.port
    )
  }).length
}

export const requestDisconnect = (project: FleetProject): void => {
  const root = tryParseSshProjectRoot(project.rootPath)
  if (!root) {
    return
  }
  const shared = sharedProjectCount(root)
  if (shared > 1) {
    state.disconnectConfirm.value = {
      user: root.user,
      hostname: root.hostname,
      port: root.port,
      sharedCount: shared,
    }
    return
  }
  void runDisconnect(root.user, root.hostname, root.port)
}

const runDisconnect = async (user: string, hostname: string, port: number): Promise<void> => {
  state.expectUserDisconnect(user, hostname, port)
  try {
    const status = await sshDisconnect(user, hostname, port)
    state.upsertSession({
      ...status,
      user,
      hostname,
      port,
      state: 'disconnected',
      masterAlive: false,
      lastError: null,
      line: `Disconnected from ${hostname}.`,
    })
    toast.success(`${hostname} disconnected.`)
    state.releaseUserDisconnect(user, hostname, port)
  } catch (error) {
    state.clearUserDisconnect(user, hostname, port)
    toast.error(`The connection to ${hostname} did not exit.`, {
      description:
        error instanceof Error ? error.message : 'Vixl signaled only its own SSH process.',
    })
  }
}

export const confirmDisconnect = async (): Promise<void> => {
  const current = state.disconnectConfirm.value
  if (!current) {
    return
  }
  state.disconnectConfirm.value = null
  await runDisconnect(current.user, current.hostname, current.port)
}

export const openPortForward = (project: FleetProject): void => {
  const root = tryParseSshProjectRoot(project.rootPath)
  if (!root) {
    return
  }
  state.portForwardTarget.value = root
  state.portForwardRemoteHost.value = '127.0.0.1'
  state.portForwardRemotePort.value = '8080'
  state.portForwardLocalPort.value = '8080'
  state.portForwardBind.value = '127.0.0.1'
  state.portForwardError.value = ''
  state.portForwardOpen.value = true
}

export const portForwardDisabled = computed(
  () => state.portForwardBind.value.trim() === '0.0.0.0' || state.portForwardBind.value.trim() === '',
)

export const submitPortForward = async (): Promise<void> => {
  const target = state.portForwardTarget.value
  if (!target) {
    return
  }
  if (state.portForwardBind.value.trim() !== '127.0.0.1') {
    state.portForwardError.value = '0.0.0.0 is refused.'
    return
  }
  const remotePort = Number(state.portForwardRemotePort.value)
  const localPort = Number(state.portForwardLocalPort.value)
  if (!remotePort || !localPort) {
    state.portForwardError.value = 'Use a number from 1 to 65535.'
    return
  }
  try {
    await sshOpenLocalForward({
      user: target.user,
      hostname: target.hostname,
      port: target.port,
      bindAddress: '127.0.0.1',
      localPort,
      remoteHost: state.portForwardRemoteHost.value.trim() || '127.0.0.1',
      remotePort,
    })
    state.portForwardOpen.value = false
  } catch (error) {
    state.portForwardError.value = error instanceof Error ? error.message : String(error)
  }
}

export const openTrustWorkspace = (rootPath: string): void => {
  state.trustRoot.value = rootPath
  state.trustOpen.value = true
}

export const sessionForRoot = (rootPath: string | null | undefined): SshSessionStatus | null => {
  const parsed = tryParseSshProjectRoot(rootPath ?? '')
  if (!parsed) {
    return null
  }
  return (
    state.sessions.value.find(
      (item) =>
        item.user === parsed.user &&
        item.hostname === parsed.hostname &&
        item.port === parsed.port,
    ) ?? {
      user: parsed.user,
      hostname: parsed.hostname,
      port: parsed.port,
      destination: '',
      state: 'disconnected',
      line: `Disconnected from ${parsed.hostname}.`,
      lastError: null,
      masterAlive: false,
    }
  )
}

export const isDisconnectedRoot = (rootPath: string | null | undefined): boolean => {
  if (!isSshProjectRoot(rootPath ?? '')) {
    return false
  }
  const session = sessionForRoot(rootPath)
  return !session || !session.masterAlive || session.state !== 'connected'
}

export const sshNeedsInput = computed(
  () => state.confirmEvent.value !== null || state.secretEvent.value !== null,
)

export const needsInputForRoot = (rootPath: string | null | undefined): boolean => {
  if (!sshNeedsInput.value) {
    return false
  }
  const parsed = tryParseSshProjectRoot(rootPath ?? '')
  if (!parsed) {
    return false
  }
  const hostname = state.confirmEvent.value?.hostname ?? state.secretEvent.value?.hostname
  const port = state.confirmEvent.value?.port ?? state.secretEvent.value?.port
  return hostname === parsed.hostname && port === parsed.port
}
