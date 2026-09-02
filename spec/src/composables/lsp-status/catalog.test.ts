import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LspCatalogEntry,
  LspServerStatus,
  LspWorkspaceProfile,
} from '@/services/vixl/vixl-tauri'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

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

const resetState = async (): Promise<void> => {
  const { awaitingProjectLoad, installMessage, servers, warming, warmState } =
    await import('@/composables/lsp-status/state')
  if (warmState.awaitingClearTimer !== null) {
    clearTimeout(warmState.awaitingClearTimer)
    warmState.awaitingClearTimer = null
  }
  servers.value = []
  installMessage.value = null
  warming.value = false
  awaitingProjectLoad.value = new Set()
  warmState.lastWarmedRoot = null
}

describe('warmDefaults', () => {
  beforeEach(async () => {
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    lspCatalog.mockReset()
    lspCatalog.mockResolvedValue([])
    lspEnsureServer.mockReset()
    lspEnsureServer.mockResolvedValue({ id: 'typescript', running: false })
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
})
