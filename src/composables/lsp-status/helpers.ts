import type {
  LspServerDisplayState,
  LspStatusServerRow,
} from '@/types/lsp/lsp-status'
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'
import { normalizeFileUri } from '@/utils/monaco-lsp'
import {
  awaitingProjectLoad,
  diagnosticsByUri,
  installMessage,
  servers,
  warmState,
} from './state'

export const scheduleAwaitingClear = (): void => {
  if (warmState.awaitingClearTimer !== null) {
    clearTimeout(warmState.awaitingClearTimer)
  }
  warmState.awaitingClearTimer = setTimeout(() => {
    awaitingProjectLoad.value = new Set()
    warmState.awaitingClearTimer = null
  }, 20_000)
}

export const resolveDisplayState = (entry: LspCatalogEntry): LspServerDisplayState => {
  if (entry.disabled) {
    return 'disabled'
  }
  if (entry.installState === 'needs_trust') {
    return 'needs_trust'
  }
  if (entry.error) {
    return 'error'
  }
  // Prefer live process state over a stale "installing" flag left in LSP_STATES.
  if (entry.running) {
    return 'running'
  }
  if (entry.installState === 'starting') {
    return 'starting'
  }
  // Packages already on disk but ensure/start still in flight should read as
  // starting, not installing (install events cover real downloads).
  if (entry.installState === 'installing') {
    return entry.installed ? 'starting' : 'installing'
  }
  if (entry.installState === 'ready' || entry.installed) {
    return 'stopped'
  }
  return 'missing'
}

export const toStatusRow = (entry: LspCatalogEntry): LspStatusServerRow => ({
  id: entry.id,
  label: entry.label,
  extensions: entry.extensions,
  running: entry.running,
  installed: entry.installed,
  disabled: entry.disabled,
  requiresTrust: entry.requiresTrust,
  error: entry.error ?? null,
  source: entry.source ?? null,
  installState: entry.installState ?? null,
  displayState: resolveDisplayState(entry),
})

export const countSeverity = (severity: number): number => {
  let total = 0
  for (const diagnostics of diagnosticsByUri.value.values()) {
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === severity) {
        total += 1
      }
    }
  }
  return total
}

export const fileUriToProjectPath = (
  uri: string,
  projectRoot: string,
): string | null => {
  const absolute = normalizeFileUri(uri).replace(/\\/g, '/')
  const root = projectRoot.replace(/\\/g, '/').replace(/\/$/, '')
  if (absolute === root) {
    return '.'
  }
  const prefix = `${root}/`
  if (absolute.startsWith(prefix)) {
    return absolute.slice(prefix.length)
  }
  return null
}

export const clearDiagnostics = (): void => {
  diagnosticsByUri.value = new Map()
}

export const markAwaitingProjectLoad = (serverId: string): void => {
  const next = new Set(awaitingProjectLoad.value)
  next.add(serverId)
  awaitingProjectLoad.value = next
  scheduleAwaitingClear()
}

export const pruneAwaitingFromRunning = (): void => {
  const awaiting = awaitingProjectLoad.value
  if (awaiting.size === 0) {
    return
  }
  const runningIds = new Set(
    servers.value.filter((entry) => entry.running).map((entry) => entry.id),
  )
  const next = new Set(
    [...awaiting].filter((id) => !runningIds.has(id)),
  )
  if (next.size === awaiting.size) {
    return
  }
  awaitingProjectLoad.value = next
  if (next.size === 0) {
    installMessage.value = 'Language servers ready'
  }
}

export const applyReadyInstallState = (serverId: string): void => {
  servers.value = servers.value.map((entry) => {
    if (entry.id !== serverId) {
      return entry
    }
    return {
      ...entry,
      installed: true,
      installState: entry.running ? 'ready' : 'starting',
      error: null,
    }
  })
}
