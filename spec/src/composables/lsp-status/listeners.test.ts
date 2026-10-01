import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import type { LspCatalogEntry, LspServerState, LspWorkspaceProfile } from '@/services/vixl/vixl-tauri'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

type InstallPayload = {
  serverId: string
  state: string
  message?: string | null
}

type StateHandler = (event: { payload: LspServerState }) => void | Promise<void>
type InstallHandler = (event: { payload: InstallPayload }) => void | Promise<void>

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
const listen = vi.hoisted(
  () =>
    vi.fn<
      (event: string, handler: StateHandler | InstallHandler) => Promise<() => void>
    >(async () => () => {}),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

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
    pid: 42,
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

let catalogRows: LspCatalogEntry[] = []
let stateHandler: StateHandler | null = null
let installHandler: InstallHandler | null = null

const resetState = async (): Promise<void> => {
  const { unbindListeners } = await import('@/composables/lsp-status/listeners')
  const {
    diagnosticsByUri,
    installMessage,
    prefetchBusy,
    servers,
    toastedFailureKeys,
    warming,
    warmState,
  } = await import('@/composables/lsp-status/state')
  unbindListeners()
  servers.value = new Map()
  installMessage.value = null
  prefetchBusy.value = false
  warming.value = false
  diagnosticsByUri.value = new Map()
  warmState.lastWarmedRoot = null
  toastedFailureKeys.clear()
  catalogRows = []
  stateHandler = null
  installHandler = null
}

const emitState = async (state: LspServerState): Promise<void> => {
  if (stateHandler === null) {
    throw new Error('lsp state listener is not bound')
  }
  await stateHandler({ payload: state })
}

const emitInstall = async (payload: InstallPayload): Promise<void> => {
  if (installHandler === null) {
    throw new Error('lsp install listener is not bound')
  }
  await installHandler({ payload })
}

describe('lsp state listeners', () => {
  beforeEach(async () => {
    vi.useRealTimers()
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    catalogRows = []
    lspCatalog.mockReset()
    lspCatalog.mockImplementation(async () => catalogRows.map((entry) => ({ ...entry, state: { ...entry.state } })))
    lspEnsureServer.mockReset()
    lspEnsureServer.mockResolvedValue(serverState())
    lspWorkspaceProfile.mockReset()
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: [],
      warmExtensions: [],
    })
    listen.mockReset()
    listen.mockImplementation(async (event, handler) => {
      if (event === 'lsp://state') {
        stateHandler = handler as StateHandler
      }
      if (event === 'lsp://install') {
        installHandler = handler as InstallHandler
      }
      return () => {}
    })
    vi.spyOn(toast, 'error').mockImplementation(() => 0)
    await resetState()
  })

  afterEach(async () => {
    await resetState()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('ignores older and equal revisions and applies a newer one', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    const { servers } = await import('@/composables/lsp-status/state')
    catalogRows = [
      catalogEntry({
        state: serverState({ phase: 'running', revision: 5, message: 'live' }),
      }),
    ]
    await bindListeners(ref('/proj'))
    await refreshCatalog()
    lspCatalog.mockClear()

    await emitState(serverState({ phase: 'exited', revision: 4, message: 'old' }))
    await emitState(serverState({ phase: 'exited', revision: 5, message: 'same' }))
    expect(servers.value.get('typescript')?.state.phase).toBe('running')
    expect(servers.value.get('typescript')?.state.message).toBe('live')

    await emitState(serverState({ phase: 'stopping', revision: 6, message: 'new' }))
    expect(servers.value.get('typescript')?.state.phase).toBe('stopping')
    expect(servers.value.get('typescript')?.state.message).toBe('new')
    expect(lspCatalog).not.toHaveBeenCalled()
  })

  it('loads an unknown id from the catalog instead of inserting a placeholder', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { servers } = await import('@/composables/lsp-status/state')
    catalogRows = [
      catalogEntry({
        id: 'vue',
        label: 'Vue / Nuxt',
        extensions: ['vue'],
        state: serverState({
          id: 'vue',
          phase: 'starting',
          revision: 2,
          message: 'spawn',
        }),
      }),
    ]
    await bindListeners(ref('/proj'))
    lspCatalog.mockClear()

    await emitState(
      serverState({
        id: 'vue',
        phase: 'starting',
        revision: 2,
        message: 'spawn',
      }),
    )
    expect(lspCatalog).toHaveBeenCalled()

    const stored = servers.value.get('vue')
    expect(stored?.label).toBe('Vue / Nuxt')
    expect(stored?.extensions).toEqual(['vue'])
    expect(stored?.state.phase).toBe('starting')
    expect(stored?.state.revision).toBe(2)
    expect(stored?.state.message).toBe('spawn')
  })

  it('toasts once per id, generation, and phase', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { refreshCatalog } = await import('@/composables/lsp-status/catalog')
    catalogRows = [
      catalogEntry({
        state: serverState({ phase: 'running', revision: 1 }),
      }),
    ]
    await bindListeners(ref('/proj'))
    await refreshCatalog()
    expect(toast.error).not.toHaveBeenCalled()

    await emitState(
      serverState({
        phase: 'error',
        revision: 2,
        generation: 4,
        error: 'start failed',
      }),
    )
    await emitState(
      serverState({
        phase: 'error',
        revision: 3,
        generation: 4,
        error: 'start failed',
        message: 'detail',
      }),
    )
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('TypeScript', {
      description: 'start failed',
    })

    await emitState(
      serverState({
        phase: 'crashed',
        revision: 4,
        generation: 4,
        error: 'exit 9',
      }),
    )
    await emitState(
      serverState({
        phase: 'error',
        revision: 5,
        generation: 5,
        error: 'start failed',
      }),
    )
    expect(toast.error).toHaveBeenCalledTimes(3)
    expect(toast.error).toHaveBeenNthCalledWith(2, 'TypeScript', {
      description: 'exit 9',
    })
    expect(toast.error).toHaveBeenNthCalledWith(3, 'TypeScript', {
      description: 'start failed',
    })
  })

  it('polls while a row is transient or busy and stops once it settles', async () => {
    vi.useFakeTimers()
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { servers } = await import('@/composables/lsp-status/state')
    catalogRows = [
      catalogEntry({
        state: serverState({ phase: 'idle', revision: 1 }),
      }),
    ]
    servers.value = new Map([['typescript', catalogRows[0]!]])
    await bindListeners(ref('/proj'))
    lspCatalog.mockClear()

    await emitState(serverState({ phase: 'starting', revision: 2 }))
    expect(lspCatalog).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(lspCatalog).toHaveBeenCalledTimes(1)
    expect(servers.value.get('typescript')?.state.phase).toBe('starting')

    await emitState(serverState({ phase: 'starting', revision: 3 }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(lspCatalog).toHaveBeenCalledTimes(2)

    await emitState(
      serverState({
        phase: 'running',
        revision: 4,
        activity: {
          token: '1',
          title: 'Loading project',
          message: null,
          percentage: null,
        },
      }),
    )
    await vi.advanceTimersByTimeAsync(5_000)
    expect(lspCatalog).toHaveBeenCalledTimes(3)

    await emitState(serverState({ phase: 'running', revision: 5, activity: null }))
    await vi.advanceTimersByTimeAsync(5_000)
    expect(lspCatalog).toHaveBeenCalledTimes(3)
  })

  it('stops polling when listeners unbind', async () => {
    vi.useFakeTimers()
    const { bindListeners, unbindListeners } = await import(
      '@/composables/lsp-status/listeners'
    )
    const { servers } = await import('@/composables/lsp-status/state')
    catalogRows = [catalogEntry()]
    servers.value = new Map([['typescript', catalogRows[0]!]])
    await bindListeners(ref('/proj'))
    lspCatalog.mockClear()
    await emitState(serverState({ phase: 'installing', revision: 2 }))
    unbindListeners()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(lspCatalog).not.toHaveBeenCalled()
  })

  it('refreshes the catalog when the window is focused or shown', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    await bindListeners(ref('/proj'))
    await bindListeners(ref('/proj'))
    lspCatalog.mockClear()

    window.dispatchEvent(new Event('focus'))
    await vi.waitFor(() => {
      expect(lspCatalog).toHaveBeenCalledTimes(1)
    })

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(lspCatalog).toHaveBeenCalledTimes(2)
    })
  })

  it('tracks aggregate prefetch on lsp://install and ignores per-server events', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { installMessage, prefetchBusy, servers } = await import(
      '@/composables/lsp-status/state'
    )
    catalogRows = [
      catalogEntry({
        state: serverState({ phase: 'idle', revision: 1 }),
      }),
    ]
    const projectRoot = ref<string | null>('/proj')
    await bindListeners(projectRoot)
    await emitState(serverState({ phase: 'idle', revision: 1 }))
    lspCatalog.mockClear()
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript'],
      warmExtensions: ['ts'],
    })

    await emitInstall({
      serverId: 'typescript',
      state: 'installing',
      message: 'Installing typescript',
    })
    expect(prefetchBusy.value).toBe(false)
    expect(installMessage.value).toBeNull()
    expect(servers.value.get('typescript')?.state.phase).toBe('idle')
    expect(lspCatalog).not.toHaveBeenCalled()

    await emitInstall({
      serverId: 'node',
      state: 'installing',
      message: 'Downloading portable Node',
    })
    expect(installMessage.value).toBe('Downloading portable Node')
    expect(prefetchBusy.value).toBe(false)

    await emitInstall({
      serverId: '*',
      state: 'installing',
      message: 'Installing language support',
    })
    expect(prefetchBusy.value).toBe(true)
    expect(installMessage.value).toBe('Installing language support')

    await emitInstall({
      serverId: '*',
      state: 'error',
      message: 'Language support failed',
    })
    expect(prefetchBusy.value).toBe(false)
    expect(installMessage.value).toBe('Language support failed')
    expect(lspEnsureServer).not.toHaveBeenCalled()

    await emitInstall({
      serverId: '*',
      state: 'installing',
      message: 'Installing language support',
    })
    await emitInstall({
      serverId: '*',
      state: 'ready',
      message: 'Language support ready',
    })
    expect(prefetchBusy.value).toBe(false)
    expect(installMessage.value).toBe('Language support ready')
    expect(lspWorkspaceProfile).toHaveBeenCalledWith('/proj')
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/proj')
  })

  it('warms only after a project root is known, and follows later updates', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript'],
      warmExtensions: ['ts'],
    })
    await bindListeners()

    await emitInstall({
      serverId: '*',
      state: 'ready',
      message: 'Language support ready',
    })
    expect(lspWorkspaceProfile).not.toHaveBeenCalled()
    expect(lspEnsureServer).not.toHaveBeenCalled()

    const projectRoot = ref<string | null>('/first')
    await bindListeners(projectRoot)
    await emitInstall({
      serverId: '*',
      state: 'installing',
      message: 'Installing language support',
    })
    await emitInstall({
      serverId: '*',
      state: 'ready',
      message: 'Language support ready',
    })
    expect(lspWorkspaceProfile).toHaveBeenCalledWith('/first')
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/first')

    projectRoot.value = '/second'
    lspWorkspaceProfile.mockClear()
    lspEnsureServer.mockClear()
    await emitInstall({
      serverId: '*',
      state: 'installing',
      message: 'Installing language support',
    })
    await emitInstall({
      serverId: '*',
      state: 'ready',
      message: 'Language support ready',
    })
    expect(lspWorkspaceProfile).toHaveBeenCalledWith('/second')
    expect(lspEnsureServer).toHaveBeenCalledWith('ts', '/second')
  })
})
