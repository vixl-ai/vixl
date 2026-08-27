import {
  isTauri,
  lspCatalog,
  lspEnsureServer,
  lspWorkspaceProfile,
} from '@/services/vixl/vixl-tauri'
import { scheduleAwaitingClear } from './helpers'
import {
  awaitingProjectLoad,
  installMessage,
  servers,
  warming,
  warmState,
} from './state'

const desiredServersRunning = (ids: string[]): boolean =>
  ids.every((id) => Boolean(servers.value.find((entry) => entry.id === id)?.running))

export const refreshCatalog = async (): Promise<void> => {
  if (!isTauri()) {
    return
  }
  try {
    servers.value = await lspCatalog()
  } catch (error) {
    installMessage.value =
      error instanceof Error ? error.message : 'Failed to load language servers'
  }
}

export const warmDefaults = async (root: string, force = false): Promise<void> => {
  if (!isTauri() || warming.value) {
    return
  }

  let ids: string[] = []
  let extensions: string[] = []
  try {
    const profile = await lspWorkspaceProfile(root)
    ids = profile.warm
    extensions = profile.warmExtensions
  } catch (error) {
    installMessage.value =
      error instanceof Error
        ? error.message
        : 'Failed to detect workspace language servers'
  }
  if (ids.length === 0 || extensions.length === 0) {
    warmState.lastWarmedRoot = root
    return
  }
  if (!force && warmState.lastWarmedRoot === root && desiredServersRunning(ids)) {
    return
  }

  warming.value = true
  installMessage.value = 'Starting language servers'
  awaitingProjectLoad.value = new Set(ids)
  scheduleAwaitingClear()
  try {
    const results = await Promise.allSettled(
      extensions.map((ext) => lspEnsureServer(ext, root)),
    )
    const firstRejected = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    )
    if (firstRejected) {
      installMessage.value =
        firstRejected.reason instanceof Error
          ? firstRejected.reason.message
          : 'Failed to start language servers'
    }
    warmState.lastWarmedRoot = root
  } catch (error) {
    installMessage.value =
      error instanceof Error ? error.message : 'Failed to start language servers'
    awaitingProjectLoad.value = new Set()
  } finally {
    warming.value = false
    await refreshCatalog()
  }
}
