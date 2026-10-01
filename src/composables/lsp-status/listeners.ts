import { ref, type Ref } from 'vue'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@/services/vixl/vixl-tauri'
import type { LspServerState } from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'
import { parseLspDiagnostics } from '@/utils/monaco-lsp'
import { applyServerState } from './apply-state'
import {
  invalidateCatalogRefresh,
  refreshCatalog,
  stopLspStatePoll,
  syncLspStatePoll,
  warmDefaults,
} from './catalog'
import {
  diagnosticsByUri,
  installMessage,
  listenerState,
  prefetchBusy,
  servers,
} from './state'
import { noteServerState } from './toasts'

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

const handleWindowFocus = (): void => {
  void refreshCatalog()
}

const handleVisibilityChange = (): void => {
  if (document.visibilityState === 'visible') {
    void refreshCatalog()
  }
}

const handleServerState = async (state: LspServerState): Promise<void> => {
  if (!servers.value.has(state.id)) {
    await refreshCatalog()
    const entry = servers.value.get(state.id)
    if (entry) {
      noteServerState(entry.state, entry.label)
    }
    syncLspStatePoll()
    return
  }
  if (!applyServerState(state)) {
    return
  }
  const entry = servers.value.get(state.id)
  if (entry) {
    noteServerState(state, entry.label)
  }
  syncLspStatePoll()
}

const emptyProjectRoot = ref<string | null>(null)
let activeProjectRoot: Ref<string | null> = emptyProjectRoot

const handleInstall = async (payload: LspInstallProgress): Promise<void> => {
  const { serverId, state, message } = payload
  if (serverId !== '*' && serverId !== 'node') {
    return
  }
  installMessage.value = message ?? `${serverId}: ${state}`
  if (serverId !== '*') {
    return
  }
  if (state === 'installing') {
    prefetchBusy.value = true
  }
  if (state === 'ready' || state === 'error') {
    prefetchBusy.value = false
    await refreshCatalog()
    const root = activeProjectRoot.value
    if (state === 'ready' && root) {
      await warmDefaults(root)
    }
  }
  syncLspStatePoll()
}

export const bindListeners = async (
  projectRoot?: Ref<string | null>,
): Promise<void> => {
  if (projectRoot) {
    activeProjectRoot = projectRoot
  }
  if (!isTauri() || listenerState.bound) {
    return
  }
  listenerState.bound = true
  window.addEventListener('focus', handleWindowFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  try {
    listenerState.unlistenInstall = await listen<LspInstallProgress>(
      'lsp://install',
      async (event) => {
        try {
          await handleInstall(event.payload)
        } catch (error: unknown) {
          installMessage.value = formatUnknownError(error)
        }
      },
    )
  } catch (error) {
    unbindListeners()
    throw error
  }

  try {
    listenerState.unlistenState = await listen<LspServerState>(
      'lsp://state',
      async (event) => {
        try {
          await handleServerState(event.payload)
        } catch (error: unknown) {
          installMessage.value = formatUnknownError(error)
        }
      },
    )
  } catch (error) {
    unbindListeners()
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
      },
    )
  } catch (error) {
    installMessage.value = formatUnknownError(error)
  }

  syncLspStatePoll()
}

export const unbindListeners = (): void => {
  invalidateCatalogRefresh()
  stopLspStatePoll()
  window.removeEventListener('focus', handleWindowFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  listenerState.unlistenInstall?.()
  listenerState.unlistenInstall = null
  listenerState.unlistenState?.()
  listenerState.unlistenState = null
  listenerState.unlistenDiagnostics?.()
  listenerState.unlistenDiagnostics = null
  listenerState.bound = false
  activeProjectRoot = emptyProjectRoot
  emptyProjectRoot.value = null
}
