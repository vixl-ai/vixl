import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import type { LspCatalogEntry, LspServerState, LspWorkspaceProfile } from '@/services/vixl/vixl-tauri'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const isTauri = vi.hoisted(() => vi.fn<() => boolean>(() => true))
const lspCatalog = vi.hoisted(
  () => vi.fn<() => Promise<LspCatalogEntry[]>>(async () => []),
)
const lspEnsureServer = vi.hoisted(
  () =>
    vi.fn<(extension: string, projectRoot?: string | null) => Promise<LspServerState>>(),
)
const lspWorkspaceProfile = vi.hoisted(
  () =>
    vi.fn<(projectRoot: string) => Promise<LspWorkspaceProfile>>(async () => ({
      vueNuxt: false,
      warm: [],
      warmExtensions: [],
    })),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => isTauri(),
    lspCatalog: () => lspCatalog(),
    lspEnsureServer: (extension: string, projectRoot?: string | null) =>
      lspEnsureServer(extension, projectRoot),
    lspWorkspaceProfile: (projectRoot: string) => lspWorkspaceProfile(projectRoot),
  }),
)

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

const resetState = async (): Promise<void> => {
  const { invalidateCatalogRefresh } = await import('@/composables/lsp-status/catalog')
  const { toastedFailureKeys, installMessage, servers, warming, warmState } =
    await import('@/composables/lsp-status/state')
  invalidateCatalogRefresh()
  servers.value = new Map()
  installMessage.value = null
  warming.value = false
  warmState.lastWarmedRoot = null
  toastedFailureKeys.clear()
}

describe('refreshCatalog revision merge', () => {
  beforeEach(async () => {
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    lspCatalog.mockReset()
    lspEnsureServer.mockReset()
    lspWorkspaceProfile.mockReset()
    vi.spyOn(toast, 'error').mockImplementation(() => 0)
    await resetState()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await resetState()
  })

  it('keeps a live state when the catalog fallback is revision 0 and still refreshes meta', async () => {
    const { servers } = await import('@/composables/lsp-status/state')
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    servers.value = new Map([
      [
        'typescript',
        catalogEntry({
          disabled: false,
          installed: true,
          state: serverState({ phase: 'running', revision: 5, message: 'live' }),
        }),
      ],
    ])
    lspCatalog.mockResolvedValue([
      catalogEntry({
        disabled: true,
        installed: false,
        label: 'TypeScript / JavaScript',
        state: serverState({
          phase: 'missing',
          revision: 0,
          generation: 0,
          phaseSinceMs: 0,
          message: null,
          source: 'none',
          running: false,
        }),
      }),
    ])

    await refreshCatalog()

    const stored = servers.value.get('typescript')
    expect(stored?.disabled).toBe(true)
    expect(stored?.installed).toBe(false)
    expect(stored?.label).toBe('TypeScript / JavaScript')
    expect(stored?.state.revision).toBe(5)
    expect(stored?.state.phase).toBe('running')
    expect(stored?.state.message).toBe('live')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('replaces an older live state and does not replace an equal live revision', async () => {
    const { servers } = await import('@/composables/lsp-status/state')
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    servers.value = new Map([
      [
        'typescript',
        catalogEntry({
          state: serverState({ phase: 'running', revision: 5, message: 'live' }),
        }),
      ],
    ])
    lspCatalog.mockResolvedValueOnce([
      catalogEntry({
        state: serverState({ phase: 'crashed', revision: 5, message: 'other', error: 'nope' }),
      }),
    ])

    await refreshCatalog()
    expect(servers.value.get('typescript')?.state.message).toBe('live')
    expect(servers.value.get('typescript')?.state.phase).toBe('running')

    lspCatalog.mockResolvedValueOnce([
      catalogEntry({
        state: serverState({
          phase: 'crashed',
          revision: 6,
          message: 'killed',
          error: 'exit 9',
        }),
      }),
    ])
    await refreshCatalog()
    expect(servers.value.get('typescript')?.state.phase).toBe('crashed')
    expect(servers.value.get('typescript')?.state.message).toBe('killed')
  })

  it('lets a newer revision 0 fallback replace an older one', async () => {
    const { servers } = await import('@/composables/lsp-status/state')
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    servers.value = new Map([
      [
        'typescript',
        catalogEntry({
          installed: false,
          state: serverState({
            phase: 'missing',
            revision: 0,
            generation: 0,
            phaseSinceMs: 0,
          }),
        }),
      ],
    ])
    lspCatalog.mockResolvedValue([
      catalogEntry({
        installed: true,
        state: serverState({
          phase: 'idle',
          revision: 0,
          generation: 0,
          phaseSinceMs: 0,
          source: 'path',
        }),
      }),
    ])

    await refreshCatalog()
    expect(servers.value.get('typescript')?.state.phase).toBe('idle')
    expect(servers.value.get('typescript')?.installed).toBe(true)
  })

  it('does not toast an error that is already present on the first catalog snapshot', async () => {
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    lspCatalog.mockResolvedValue([
      catalogEntry({
        state: serverState({
          phase: 'error',
          revision: 4,
          error: 'timed out',
        }),
      }),
    ])

    await refreshCatalog()
    expect(toast.error).not.toHaveBeenCalled()

    lspCatalog.mockResolvedValue([
      catalogEntry({
        state: serverState({
          phase: 'error',
          revision: 5,
          generation: 2,
          error: 'timed out again',
        }),
      }),
    ])
    await refreshCatalog()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('TypeScript', {
      description: 'timed out again',
    })

    await refreshCatalog()
    expect(toast.error).toHaveBeenCalledTimes(1)

    lspCatalog.mockResolvedValue([
      catalogEntry({
        state: serverState({
          phase: 'crashed',
          revision: 6,
          generation: 2,
          error: 'exit 9',
        }),
      }),
    ])
    await refreshCatalog()
    expect(toast.error).toHaveBeenCalledTimes(2)
    expect(toast.error).toHaveBeenLastCalledWith('TypeScript', {
      description: 'exit 9',
    })
  })
})

describe('warmDefaults', () => {
  beforeEach(async () => {
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    lspCatalog.mockReset()
    lspCatalog.mockResolvedValue([])
    lspEnsureServer.mockReset()
    lspEnsureServer.mockResolvedValue(serverState())
    lspWorkspaceProfile.mockReset()
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: [],
      warmExtensions: [],
    })
    await resetState()
  })

  afterEach(async () => {
    await resetState()
  })

  it('does not drop warmDefaults(force) while warming is true', async () => {
    const { warming } = await import('@/composables/lsp-status/state')
    const { warmDefaults } = await import('@/composables/lsp-status/catalog')

    warming.value = true
    await warmDefaults('/proj', false)
    expect(lspWorkspaceProfile).not.toHaveBeenCalled()

    await warmDefaults('/proj', true)
    expect(lspWorkspaceProfile).toHaveBeenCalledTimes(1)
    expect(lspWorkspaceProfile).toHaveBeenCalledWith('/proj')
  })

  it('skips ensure when that root is already running', async () => {
    const { servers, warmState } = await import('@/composables/lsp-status/state')
    const { warmDefaults } = await import('@/composables/lsp-status/catalog')
    servers.value = new Map([
      [
        'typescript',
        catalogEntry({
          state: serverState({ phase: 'running', revision: 3 }),
        }),
      ],
    ])
    warmState.lastWarmedRoot = '/proj'
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript'],
      warmExtensions: ['ts'],
    })

    await warmDefaults('/proj')
    expect(lspEnsureServer).not.toHaveBeenCalled()
  })

  it('starts ensure when the warmed server is not running', async () => {
    const { servers, warmState } = await import('@/composables/lsp-status/state')
    const { warmDefaults } = await import('@/composables/lsp-status/catalog')
    servers.value = new Map([
      [
        'typescript',
        catalogEntry({
          state: serverState({ phase: 'starting', revision: 3 }),
        }),
      ],
    ])
    warmState.lastWarmedRoot = '/proj'
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript'],
      warmExtensions: ['ts'],
    })

    await warmDefaults('/proj')
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/proj')
  })

  it('does not copy per-server ensure failures onto installMessage', async () => {
    const { installMessage } = await import('@/composables/lsp-status/state')
    const { warmDefaults } = await import('@/composables/lsp-status/catalog')
    lspEnsureServer.mockRejectedValue(new Error('binary missing'))
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript'],
      warmExtensions: ['ts'],
    })

    await warmDefaults('/proj')
    expect(installMessage.value).toBeNull()
    expect(lspEnsureServer).toHaveBeenCalledTimes(1)
  })
})
