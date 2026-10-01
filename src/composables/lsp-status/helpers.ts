import type {
  LspActivity,
  LspCatalogEntry,
  LspPhase,
  LspServerState,
} from '@/services/vixl/vixl-tauri'
import type {
  LspHealth,
  LspServerDisplayState,
  LspStatusServerRow,
} from '@/types/lsp/lsp-status'
import { normalizeFileUri } from '@/utils/monaco-lsp'
import { diagnosticsByUri } from './state'

const TRANSIENT_PHASES: ReadonlySet<LspPhase> = new Set([
  'installing',
  'starting',
  'stopping',
])

export const isTransientPhase = (phase: LspServerDisplayState): boolean =>
  phase !== 'disabled' && TRANSIENT_PHASES.has(phase)

export const phaseLabel: Record<LspServerDisplayState, string> = {
  missing: 'Not installed',
  idle: 'Idle',
  needs_trust: 'Needs trust',
  installing: 'Installing',
  starting: 'Starting',
  running: 'Running',
  stopping: 'Stopping',
  stopped: 'Stopped',
  exited: 'Exited',
  crashed: 'Crashed',
  error: 'Error',
  disabled: 'Disabled',
}

export const formatActivityLabel = (activity: LspActivity): string => {
  let text = activity.title
  if (activity.message) {
    text += `: ${activity.message}`
  }
  if (activity.percentage !== null) {
    text += ` ${activity.percentage}%`
  }
  return text
}

const HIDDEN_DISPLAY_STATES: ReadonlySet<LspServerDisplayState> = new Set([
  'disabled',
  'idle',
  'missing',
  'stopped',
])

// Revision 0 is the catalog fallback, so a later 0 may replace an earlier 0.
export const catalogRevisionWins = (stored: number, incoming: number): boolean =>
  incoming > stored || (incoming === stored && stored === 0)

export const resolveDisplayState = (entry: LspCatalogEntry): LspServerDisplayState =>
  entry.disabled ? 'disabled' : entry.state.phase

export const stateIsBusy = (state: LspServerState): boolean =>
  isTransientPhase(state.phase) || state.activity !== null

export const deriveIsBusy = (
  prefetch: boolean,
  entries: Iterable<LspCatalogEntry>,
): boolean => {
  if (prefetch) {
    return true
  }
  for (const entry of entries) {
    if (stateIsBusy(entry.state)) {
      return true
    }
  }
  return false
}

export const deriveHealth = (
  busy: boolean,
  rows: readonly LspStatusServerRow[],
  errorDiagnostics: number,
  warningDiagnostics: number,
): LspHealth => {
  if (busy) {
    return 'busy'
  }
  if (
    errorDiagnostics > 0 ||
    rows.some((row) => row.displayState === 'error' || row.displayState === 'crashed')
  ) {
    return 'error'
  }
  if (warningDiagnostics > 0) {
    return 'warning'
  }
  return 'ok'
}

const PHASE_ORDER: readonly LspPhase[] = [
  'error',
  'crashed',
  'needs_trust',
  'installing',
  'starting',
  'stopping',
  'exited',
  'running',
  'stopped',
  'idle',
  'missing',
]

export const compareStatusRows = (
  left: LspStatusServerRow,
  right: LspStatusServerRow,
): number => {
  const byPhase = PHASE_ORDER.indexOf(left.phase) - PHASE_ORDER.indexOf(right.phase)
  if (byPhase !== 0) {
    return byPhase
  }
  const byLabel = left.label.localeCompare(right.label)
  if (byLabel !== 0) {
    return byLabel
  }
  return left.id.localeCompare(right.id)
}

export const selectVisibleRows = (rows: readonly LspStatusServerRow[]): LspStatusServerRow[] =>
  rows
    .filter((row) => !HIDDEN_DISPLAY_STATES.has(row.displayState))
    .sort(compareStatusRows)

export const toStatusRow = (entry: LspCatalogEntry): LspStatusServerRow => {
  const { state, ...meta } = entry
  return {
    ...meta,
    ...state,
    displayState: resolveDisplayState(entry),
  }
}

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
