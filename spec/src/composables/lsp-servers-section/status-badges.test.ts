import { describe, expect, it } from 'vitest'
import {
  Activity,
  AlertCircle,
  Ban,
  HardDrive,
  Loader2,
  Package,
  PackageX,
  ShieldAlert,
  Wrench,
} from '@lucide/vue'
import type { LspActivity, LspCatalogEntry, LspPhase, LspServerState } from '@/services/vixl/vixl-tauri'
import { buildStatusBadges } from '@/composables/lsp-servers-section/status-badges'

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
    source: null,
    workspaceRoot: '/proj',
    pid: null,
    running: phase === 'running',
    ...overrides,
  }
}

const catalogEntry = (overrides: Partial<LspCatalogEntry> = {}): LspCatalogEntry => ({
  id: 'typescript',
  label: 'TypeScript',
  extensions: ['ts'],
  installKind: 'npm',
  requiresTrust: false,
  installable: true,
  installed: true,
  disabled: false,
  canDisable: true,
  state: serverState(),
  ...overrides,
})

const badgesFor = (
  overrides: Partial<LspCatalogEntry> = {},
  workspaceTrusted = true,
) => buildStatusBadges(catalogEntry(overrides), workspaceTrusted)

const keys = (overrides: Partial<LspCatalogEntry> = {}, workspaceTrusted = true) =>
  badgesFor(overrides, workspaceTrusted).map((badge) => badge.key)

describe('buildStatusBadges', () => {
  it('shows disabled and leaves the phase badges in place', () => {
    const badges = badgesFor({
      disabled: true,
      state: serverState({ phase: 'running', source: 'managed' }),
    })
    expect(badges.map((badge) => badge.key)).toEqual(['disabled', 'running', 'managed'])
    expect(badges[0]).toMatchObject({
      label: 'Disabled',
      icon: Ban,
      className: 'text-muted-foreground',
    })
  })

  it('shows the trust badge when the workspace is not trusted', () => {
    const badges = badgesFor({ requiresTrust: true }, false)
    expect(badges).toEqual([
      expect.objectContaining({
        key: 'trust',
        label: 'Requires workspace trust',
        icon: ShieldAlert,
      }),
    ])
  })

  it('shows the trust badge for needs_trust even when the workspace is trusted', () => {
    const badges = badgesFor(
      {
        requiresTrust: true,
        state: serverState({ phase: 'needs_trust' }),
      },
      true,
    )
    expect(badges.filter((badge) => badge.key === 'trust')).toHaveLength(1)
  })

  it('does not add a second trust badge when both signals match', () => {
    const badges = badgesFor(
      {
        requiresTrust: true,
        state: serverState({ phase: 'needs_trust' }),
      },
      false,
    )
    expect(badges.filter((badge) => badge.key === 'trust')).toHaveLength(1)
  })

  it('shows running only for the running phase', () => {
    expect(keys({ state: serverState({ phase: 'running' }) })).toContain('running')
    expect(badgesFor({ state: serverState({ phase: 'running' }) })[0]).toMatchObject({
      label: 'Running',
      icon: Activity,
    })
    expect(keys({ state: serverState({ phase: 'starting' }) })).not.toContain('running')
  })

  it('reads the source badge from state.source', () => {
    expect(badgesFor({ state: serverState({ source: 'managed' }) })).toEqual([
      expect.objectContaining({ key: 'managed', label: 'Managed install', icon: Package }),
    ])
    expect(badgesFor({ state: serverState({ source: 'path' }) })).toEqual([
      expect.objectContaining({
        key: 'path',
        label: 'Available on PATH',
        icon: HardDrive,
      }),
    ])
    expect(badgesFor({ state: serverState({ source: 'custom' }) })).toEqual([
      expect.objectContaining({
        key: 'custom',
        label: 'Custom configuration',
        icon: HardDrive,
      }),
    ])
  })

  it('shows not installed when the server can be installed and has no source', () => {
    const badges = badgesFor({
      installable: true,
      installed: false,
      state: serverState({ phase: 'missing', source: null }),
    })
    expect(badges).toEqual([
      expect.objectContaining({ key: 'missing', label: 'Not installed', icon: PackageX }),
    ])
  })

  it('shows the toolchain badge when nothing else explains the install', () => {
    const badges = badgesFor({
      installKind: 'toolchain',
      installable: false,
      installed: false,
      state: serverState({ phase: 'missing', source: null }),
    })
    expect(badges).toEqual([
      expect.objectContaining({
        key: 'toolchain',
        label: 'Needs toolchain on PATH',
        icon: Wrench,
      }),
    ])
  })

  it('prefers a source badge over missing and toolchain', () => {
    expect(
      keys({
        installKind: 'toolchain',
        installable: true,
        installed: false,
        state: serverState({ source: 'path' }),
      }),
    ).toEqual(['path'])
  })

  it('shows the error text for error and crashed', () => {
    expect(
      badgesFor({
        state: serverState({ phase: 'error', error: 'timed out' }),
      }),
    ).toEqual([
      expect.objectContaining({
        key: 'error',
        label: 'timed out',
        icon: AlertCircle,
        className: 'text-destructive',
      }),
    ])
    expect(
      badgesFor({
        state: serverState({ phase: 'crashed', error: 'exit 9' }),
      })[0]?.label,
    ).toBe('exit 9')
  })

  it('uses a phase label when error or crashed has no error text', () => {
    expect(
      badgesFor({ state: serverState({ phase: 'crashed', error: null }) })[0]?.label,
    ).toBe('Crashed')
    expect(
      badgesFor({ state: serverState({ phase: 'error', error: null }) })[0]?.label,
    ).toBe('Error')
  })

  it('does not show an error badge for other phases', () => {
    const phases: LspPhase[] = [
      'missing',
      'idle',
      'needs_trust',
      'installing',
      'starting',
      'running',
      'stopping',
      'stopped',
      'exited',
    ]
    for (const phase of phases) {
      expect(
        keys({ state: serverState({ phase, error: 'leftover' }) }),
      ).not.toContain('error')
    }
  })

  it.each([
    ['installing', 'Installing'],
    ['starting', 'Starting'],
    ['stopping', 'Stopping'],
  ] as const)('shows a spinning %s badge', (phase, label) => {
    const badges = badgesFor({
      state: serverState({ phase, message: 'Downloading vue' }),
    })
    expect(badges.find((badge) => badge.key === 'state')).toMatchObject({
      label,
      tooltip: 'Downloading vue',
      icon: Loader2,
      className: 'text-muted-foreground',
    })
  })

  it('omits the transient tooltip when there is no message', () => {
    const badge = badgesFor({
      state: serverState({ phase: 'starting', message: null }),
    }).find((item) => item.key === 'state')
    expect(badge?.label).toBe('Starting')
    expect(badge?.tooltip).toBeUndefined()
  })

  it('shows activity title, message, and percentage', () => {
    const activity: LspActivity = {
      token: '1',
      title: 'Loading project',
      message: 'scanning',
      percentage: 40,
    }
    const badges = badgesFor({
      state: serverState({ phase: 'running', activity, source: 'managed' }),
    })
    expect(badges.find((badge) => badge.key === 'activity')).toMatchObject({
      label: 'Loading project: scanning 40%',
      icon: Loader2,
      className: 'text-muted-foreground',
    })
  })

  it('does not add transient badges for settled phases', () => {
    const phases: LspPhase[] = [
      'missing',
      'idle',
      'needs_trust',
      'running',
      'stopped',
      'exited',
      'crashed',
      'error',
    ]
    for (const phase of phases) {
      expect(keys({ state: serverState({ phase }) })).not.toContain('state')
    }
  })
})
