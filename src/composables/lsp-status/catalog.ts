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

const warmIdsForProfile = (vueNuxt: boolean): string[] =>
  vueNuxt ? ['vue', 'typescript'] : ['typescript']

const ensureExtensionForId = (id: string): string =>
  id === 'typescript' ? 'ts' : id

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

  let vueNuxt = false
  try {
    vueNuxt = (await lspWorkspaceProfile(root)).vueNuxt
  } catch (error) {
    installMessage.value =
      error instanceof Error
        ? error.message
        : 'Failed to detect workspace language servers'
  }

  const ids = warmIdsForProfile(vueNuxt)
  if (!force && warmState.lastWarmedRoot === root && desiredServersRunning(ids)) {
    return
  }

  warming.value = true
  installMessage.value = 'Starting language servers'
  awaitingProjectLoad.value = new Set(ids)
  scheduleAwaitingClear()
  try {
    await Promise.all(
      ids.map((id) => lspEnsureServer(ensureExtensionForId(id), root)),
    )
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
