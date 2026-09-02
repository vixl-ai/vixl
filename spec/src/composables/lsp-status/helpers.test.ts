import { beforeEach, describe, expect, it } from 'vitest'
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'
import {
  pruneAwaitingFromRunning,
  resolveDisplayState,
} from '@/composables/lsp-status/helpers'
import {
  awaitingProjectLoad,
  installMessage,
  servers,
} from '@/composables/lsp-status/state'

const catalogEntry = (overrides: Partial<LspCatalogEntry> = {}): LspCatalogEntry => ({
  id: 'typescript',
  label: 'TypeScript',
  extensions: ['ts', 'tsx'],
  installKind: 'npm',
  requiresTrust: false,
  installable: true,
  installed: false,
  running: false,
  disabled: false,
  error: null,
  source: null,
  installState: null,
  ...overrides,
})

describe('resolveDisplayState', () => {
  it('prefers running over stale starting and installing', () => {
    expect(
      resolveDisplayState(
        catalogEntry({ running: true, installState: 'starting', installed: true }),
      ),
    ).toBe('running')
    expect(
      resolveDisplayState(
        catalogEntry({ running: true, installState: 'installing', installed: true }),
      ),
    ).toBe('running')
  })

  it('returns disabled before other states', () => {
    expect(
      resolveDisplayState(
        catalogEntry({ disabled: true, running: true, installState: 'ready' }),
      ),
    ).toBe('disabled')
  })

  it('returns needs_trust when installState is needs_trust', () => {
    expect(
      resolveDisplayState(catalogEntry({ installState: 'needs_trust' })),
    ).toBe('needs_trust')
  })

  it('returns error when an error is present', () => {
    expect(
      resolveDisplayState(
        catalogEntry({ error: 'failed to start', running: true }),
      ),
    ).toBe('error')
  })

  it('returns starting while spawn is in flight', () => {
    expect(
      resolveDisplayState(
        catalogEntry({ installed: true, installState: 'starting' }),
      ),
    ).toBe('starting')
    expect(
      resolveDisplayState(
        catalogEntry({ installed: true, installState: 'installing' }),
      ),
    ).toBe('starting')
  })

  it('returns installing when a download is in progress', () => {
    expect(
      resolveDisplayState(catalogEntry({ installState: 'installing' })),
    ).toBe('installing')
  })

  it('returns stopped when installed but not running', () => {
    expect(
      resolveDisplayState(
        catalogEntry({ installed: true, installState: 'ready' }),
      ),
    ).toBe('stopped')
  })

  it('returns missing when the server is not installed', () => {
    expect(resolveDisplayState(catalogEntry())).toBe('missing')
  })
})

describe('pruneAwaitingFromRunning', () => {
  beforeEach(() => {
    servers.value = []
    awaitingProjectLoad.value = new Set()
    installMessage.value = null
  })

  it('removes catalog rows that are running without waiting for diagnostics', () => {
    awaitingProjectLoad.value = new Set(['typescript', 'python'])
    servers.value = [
      catalogEntry({ id: 'typescript', running: true }),
      catalogEntry({ id: 'python', running: false }),
    ]
    pruneAwaitingFromRunning()
    expect([...awaitingProjectLoad.value]).toEqual(['python'])
    expect(installMessage.value).toBeNull()
  })

  it('clears awaiting and reports ready when every awaited server is running', () => {
    awaitingProjectLoad.value = new Set(['typescript'])
    servers.value = [catalogEntry({ running: true })]
    pruneAwaitingFromRunning()
    expect(awaitingProjectLoad.value.size).toBe(0)
    expect(installMessage.value).toBe('Language servers ready')
  })
})
