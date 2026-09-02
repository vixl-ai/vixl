import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type {
  LspCatalogEntry,
  LspServerStatus,
  LspWorkspaceProfile,
} from '@/services/vixl/vixl-tauri'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

type InstallPayload = {
  serverId: string
  state: string
  message?: string | null
}

type InstallHandler = (event: { payload: InstallPayload }) => void | Promise<void>

const isTauri = vi.hoisted(() => vi.fn<() => boolean>(() => true))
const lspCatalog = vi.hoisted(
  () => vi.fn<() => Promise<LspCatalogEntry[]>>(async () => []),
)
const lspEnsureServer = vi.hoisted(
  () =>
    vi.fn<
      (extension: string, projectRoot?: string | null) => Promise<LspServerStatus>
    >(async () => ({ id: 'typescript', running: false })),
)
const lspWorkspaceProfile = vi.hoisted(
  () =>
    vi.fn<(projectRoot: string) => Promise<LspWorkspaceProfile>>(async () => ({
      vueNuxt: false,
      warm: ['typescript', 'python'],
      warmExtensions: ['ts', 'py'],
    })),
)
const listen = vi.hoisted(
  () =>
    vi.fn<
      (event: string, handler: InstallHandler) => Promise<() => void>
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

let catalogRows: LspCatalogEntry[] = []
let installHandler: InstallHandler | null = null

const resetState = async (): Promise<void> => {
  const { unbindListeners } = await import('@/composables/lsp-status/listeners')
  const { awaitingProjectLoad, installMessage, servers, warming, warmState } =
    await import('@/composables/lsp-status/state')
  unbindListeners()
  if (warmState.awaitingClearTimer !== null) {
    clearTimeout(warmState.awaitingClearTimer)
    warmState.awaitingClearTimer = null
  }
  servers.value = []
  installMessage.value = null
  warming.value = false
  awaitingProjectLoad.value = new Set()
  warmState.lastWarmedRoot = null
  catalogRows = []
  installHandler = null
}

const emitInstall = async (payload: InstallPayload): Promise<void> => {
  if (installHandler === null) {
    throw new Error('lsp install listener is not bound')
  }
  await installHandler({ payload })
}

const row = async (id: string): Promise<LspCatalogEntry> => {
  const { servers } = await import('@/composables/lsp-status/state')
  const entry = servers.value.find((server) => server.id === id)
  if (!entry) {
    throw new Error(`missing catalog row ${id}`)
  }
  return entry
}

describe('lsp install listeners', () => {
  beforeEach(async () => {
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    catalogRows = []
    lspCatalog.mockReset()
    lspCatalog.mockImplementation(async () => catalogRows.map((entry) => ({ ...entry })))
    lspEnsureServer.mockReset()
    lspEnsureServer.mockImplementation((extension: string) => {
      if (extension === 'py') {
        return new Promise<LspServerStatus>(() => {})
      }
      return Promise.resolve({ id: 'typescript', running: false })
    })
    lspWorkspaceProfile.mockReset()
    lspWorkspaceProfile.mockResolvedValue({
      vueNuxt: false,
      warm: ['typescript', 'python'],
      warmExtensions: ['ts', 'py'],
    })
    listen.mockReset()
    listen.mockImplementation(async (event, handler) => {
      if (event === 'lsp://install') {
        installHandler = handler
      }
      return () => {}
    })
    await resetState()
  })

  afterEach(async () => {
    await resetState()
  })

  it('refreshes to running on process ready and does not wait on a hung sibling', async () => {
    const { bindListeners } = await import('@/composables/lsp-status/listeners')
    const { warmDefaults } = await import('@/composables/lsp-status/catalog')
    const { resolveDisplayState } = await import('@/composables/lsp-status/helpers')
    const { awaitingProjectLoad, warming } = await import(
      '@/composables/lsp-status/state'
    )

    const projectRoot = ref<string | null>('/proj')
    await bindListeners(projectRoot)

    let warmSettled = false
    const warmingPromise = warmDefaults('/proj').then(
      () => {
        warmSettled = true
      },
      () => {
        warmSettled = true
      },
    )
    await vi.waitFor(() => {
      expect(warming.value).toBe(true)
      expect(awaitingProjectLoad.value.has('typescript')).toBe(true)
      expect(awaitingProjectLoad.value.has('python')).toBe(true)
    })

    catalogRows = [
      catalogEntry({
        id: 'typescript',
        installed: true,
        running: false,
        installState: 'ready',
      }),
      catalogEntry({
        id: 'python',
        label: 'Python',
        extensions: ['py'],
        installed: false,
        running: false,
        installState: 'installing',
      }),
    ]
    await emitInstall({ serverId: 'typescript', state: 'ready' })

    expect(resolveDisplayState(await row('typescript'))).toBe('starting')
    expect(awaitingProjectLoad.value.has('typescript')).toBe(true)

    catalogRows = [
      catalogEntry({
        id: 'typescript',
        installed: true,
        running: true,
        installState: 'ready',
      }),
      catalogEntry({
        id: 'python',
        label: 'Python',
        extensions: ['py'],
        installed: false,
        running: false,
        installState: 'installing',
      }),
    ]
    await emitInstall({ serverId: 'typescript', state: 'ready' })

    expect(resolveDisplayState(await row('typescript'))).toBe('running')
    expect(resolveDisplayState(await row('python'))).toBe('installing')
    expect(awaitingProjectLoad.value.has('typescript')).toBe(false)
    expect(awaitingProjectLoad.value.has('python')).toBe(true)
    expect(warming.value).toBe(true)
    expect(warmSettled).toBe(false)
    expect(warmingPromise).toBeInstanceOf(Promise)
    expect(lspCatalog.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
