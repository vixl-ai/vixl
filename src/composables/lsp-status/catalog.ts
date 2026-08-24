import {
  isTauri,
  lspCatalog,
  lspEnsureServer,
} from '@/services/vixl/vixl-tauri'
import { scheduleAwaitingClear } from './helpers'
import {
  awaitingProjectLoad,
  installMessage,
  servers,
  warming,
  warmState,
} from './state'

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
  if (!force && warmState.lastWarmedRoot === root) {
    const vue = servers.value.find((entry) => entry.id === 'vue')
    const typescript = servers.value.find((entry) => entry.id === 'typescript')
    if (vue?.running && typescript?.running) {
      return
    }
  }
  warming.value = true
  installMessage.value = 'Starting language servers'
  awaitingProjectLoad.value = new Set(['vue', 'typescript'])
  scheduleAwaitingClear()
  try {
    await Promise.all([
      lspEnsureServer('vue', root),
      lspEnsureServer('ts', root),
    ])
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
