import { beforeEach, describe, expect, it } from 'vitest'
import type { LspActivity, LspCatalogEntry, LspPhase, LspServerState } from '@/services/vixl/vixl-tauri'
import {
  deriveHealth,
  deriveIsBusy,
  formatActivityLabel,
  isTransientPhase,
  phaseLabel,
  resolveDisplayState,
  selectVisibleRows,
  toStatusRow,
} from '@/composables/lsp-status/helpers'
import { warming } from '@/composables/lsp-status/state'

const PHASES: LspPhase[] = [
  'missing',
  'idle',
  'needs_trust',
  'installing',
  'starting',
  'running',
  'stopping',
  'stopped',
  'exited',
  'crashed',
  'error',
]

const serverState = (overrides: Partial<LspServerState> = {}): LspServerState => {
  const phase = overrides.phase ?? 'idle'
  return {
    id: 'typescript',
    phase,
    generation: 1,
    revision: 1,
    phaseSinceMs: 1_700_000_000_000,
    message: null,
    error: null,
    activity: null,
    source: 'managed',
    workspaceRoot: '/proj',
    pid: null,
    running: phase === 'running',
    ...overrides,
  }
}

const catalogEntry = (overrides: Partial<LspCatalogEntry> = {}): LspCatalogEntry => ({
  id: 'typescript',
  label: 'TypeScript',
  extensions: ['ts', 'tsx'],
  installKind: 'npm',
  requiresTrust: false,
  installable: true,
  installed: true,
  disabled: false,
  canDisable: true,
  state: serverState(),
  ...overrides,
})

const activity = (overrides: Partial<LspActivity> = {}): LspActivity => ({
  token: '1',
  title: 'Loading project',
  message: null,
  percentage: 40,
  ...overrides,
})

describe('phase labels', () => {
  it('names every display state once', () => {
    expect(phaseLabel.installing).toBe('Installing')
    expect(phaseLabel.starting).toBe('Starting')
    expect(phaseLabel.stopping).toBe('Stopping')
    expect(phaseLabel.missing).toBe('Not installed')
    expect(phaseLabel.needs_trust).toBe('Needs trust')
    expect(phaseLabel.disabled).toBe('Disabled')
    expect(Object.keys(phaseLabel)).toHaveLength(PHASES.length + 1)
  })

  it('treats only installing, starting, and stopping as transient', () => {
    expect(isTransientPhase('installing')).toBe(true)
    expect(isTransientPhase('starting')).toBe(true)
    expect(isTransientPhase('stopping')).toBe(true)
    expect(isTransientPhase('disabled')).toBe(false)
    expect(isTransientPhase('running')).toBe(false)
  })

  it('formats activity title, message, and percentage', () => {
    expect(formatActivityLabel(activity())).toBe('Loading project 40%')
    expect(
      formatActivityLabel(activity({ message: 'scanning', percentage: null })),
    ).toBe('Loading project: scanning')
  })
})

describe('resolveDisplayState', () => {
  it('returns disabled before the phase', () => {
    expect(
      resolveDisplayState(
        catalogEntry({
          disabled: true,
          state: serverState({ phase: 'running' }),
        }),
      ),
    ).toBe('disabled')
  })

  it('returns the backend phase for every other row', () => {
    for (const phase of PHASES) {
      expect(
        resolveDisplayState(catalogEntry({ state: serverState({ phase }) })),
      ).toBe(phase)
    }
  })
})

describe('deriveIsBusy', () => {
  beforeEach(() => {
    warming.value = false
  })

  it('treats prefetch, transient phases, and activity as busy', () => {
    const idle = catalogEntry()
    expect(deriveIsBusy(false, [idle])).toBe(false)
    expect(deriveIsBusy(true, [idle])).toBe(true)
    for (const phase of ['installing', 'starting', 'stopping'] as const) {
      expect(
        deriveIsBusy(false, [catalogEntry({ state: serverState({ phase }) })]),
      ).toBe(true)
    }
    expect(
      deriveIsBusy(false, [
        catalogEntry({
          state: serverState({ phase: 'running', activity: activity() }),
        }),
      ]),
    ).toBe(true)
  })

  it('does not treat warming as busy', () => {
    warming.value = true
    expect(deriveIsBusy(false, [catalogEntry()])).toBe(false)
    expect(
      deriveIsBusy(false, [
        catalogEntry({ state: serverState({ phase: 'running' }) }),
      ]),
    ).toBe(false)
  })
})

describe('deriveHealth', () => {
  const row = (phase: LspPhase) => toStatusRow(catalogEntry({ state: serverState({ phase }) }))

  it('ranks busy above server failures and diagnostics', () => {
    expect(deriveHealth(true, [row('crashed')], 2, 1)).toBe('busy')
    expect(deriveHealth(false, [row('crashed')], 0, 0)).toBe('error')
    expect(deriveHealth(false, [row('error')], 0, 0)).toBe('error')
    expect(deriveHealth(false, [row('running')], 1, 0)).toBe('error')
    expect(deriveHealth(false, [row('running')], 0, 2)).toBe('warning')
    expect(deriveHealth(false, [row('running')], 0, 0)).toBe('ok')
  })
})

describe('selectVisibleRows', () => {
  it('hides idle, missing, stopped, and disabled rows and sorts failures first', () => {
    const rows = [
      toStatusRow(
        catalogEntry({
          id: 'typescript',
          label: 'TypeScript',
          state: serverState({ id: 'typescript', phase: 'running' }),
        }),
      ),
      toStatusRow(
        catalogEntry({
          id: 'python',
          label: 'Python',
          state: serverState({ id: 'python', phase: 'idle' }),
        }),
      ),
      toStatusRow(
        catalogEntry({
          id: 'rust',
          label: 'Rust',
          disabled: true,
          state: serverState({ id: 'rust', phase: 'running' }),
        }),
      ),
      toStatusRow(
        catalogEntry({
          id: 'gopls',
          label: 'Go',
          state: serverState({ id: 'gopls', phase: 'missing', revision: 0 }),
        }),
      ),
      toStatusRow(
        catalogEntry({
          id: 'vue',
          label: 'Vue',
          state: serverState({ id: 'vue', phase: 'crashed', error: 'killed' }),
        }),
      ),
      toStatusRow(
        catalogEntry({
          id: 'json',
          label: 'JSON',
          state: serverState({ id: 'json', phase: 'stopped' }),
        }),
      ),
    ]
    expect(selectVisibleRows(rows).map((entry) => entry.id)).toEqual(['vue', 'typescript'])
  })
})
