import type { Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/services/vixl/vixl-tauri'
import { parseLspDiagnostics } from '@/utils/monaco-lsp'
import { refreshCatalog, warmDefaults } from './catalog'
import {
  awaitingProjectLoad,
  diagnosticsByUri,
  installMessage,
  listenerState,
  prefetchBusy,
  servers,
} from './state'

type LspInstallProgress = {
  serverId: string
  state: string
  message?: string | null
}

type LspDiagnosticsEvent = {
  uri: string
  diagnostics: unknown
  serverId: string
}

export const bindListeners = async (
  projectRoot: Ref<string | null>,
): Promise<void> => {
  if (!isTauri() || listenerState.bound) {
    return
  }
  listenerState.bound = true

  try {
    listenerState.unlistenInstall = await listen<LspInstallProgress>(
      'lsp://install',
      (event) => {
        const { serverId, state, message } = event.payload
        installMessage.value = message ?? `${serverId}: ${state}`

        if (state === 'installing' && serverId === '*') {
          prefetchBusy.value = true
        }

        if (state === 'installing' && serverId !== '*') {
          servers.value = servers.value.map((entry) =>
            entry.id === serverId
              ? { ...entry, installState: 'installing', error: null }
              : entry,
          )
        }

        if (state === 'ready' || state === 'error') {
          if (serverId === '*') {
            prefetchBusy.value = false
          }
          if (serverId !== '*') {
            servers.value = servers.value.map((entry) => {
              if (entry.id !== serverId) {
                return entry
              }
              if (state === 'ready') {
                return {
                  ...entry,
                  installed: true,
                  installState: entry.running ? 'ready' : 'starting',
                  error: null,
                }
              }
              return {
                ...entry,
                installState: 'error',
                error: message ?? entry.error ?? 'Install failed',
              }
            })
          }
          refreshCatalog()
            .then(() => {
              if (state === 'ready' && serverId === '*' && projectRoot.value) {
                return warmDefaults(projectRoot.value)
              }
              return undefined
            })
            .catch((error: unknown) => {
              installMessage.value =
                error instanceof Error
                  ? error.message
                  : 'Failed to refresh language servers'
            })
        }
      },
    )
  } catch (error) {
    listenerState.bound = false
    throw error
  }

  try {
    listenerState.unlistenDiagnostics = await listen<LspDiagnosticsEvent>(
      'lsp://diagnostics',
      (event) => {
        const parsed = parseLspDiagnostics({
          diagnostics: event.payload.diagnostics,
        })
        const next = new Map(diagnosticsByUri.value)
        if (parsed.length === 0) {
          next.delete(event.payload.uri)
        } else {
          next.set(event.payload.uri, parsed)
        }
        diagnosticsByUri.value = next

        if (awaitingProjectLoad.value.has(event.payload.serverId)) {
          const remaining = new Set(awaitingProjectLoad.value)
          remaining.delete(event.payload.serverId)
          awaitingProjectLoad.value = remaining
          if (remaining.size === 0) {
            installMessage.value = 'Language servers ready'
          }
        }
      },
    )
  } catch (error) {
    installMessage.value =
      error instanceof Error
        ? error.message
        : 'Failed to subscribe to LSP diagnostics'
  }
}

export const unbindListeners = (): void => {
  listenerState.unlistenInstall?.()
  listenerState.unlistenInstall = null
  listenerState.unlistenDiagnostics?.()
  listenerState.unlistenDiagnostics = null
  listenerState.bound = false
}
