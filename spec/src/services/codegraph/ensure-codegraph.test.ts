import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { CodegraphStoreStat } from '@/types/codegraph/store-stat'

const codegraphStoreStat = vi.fn<(projectRoot: string) => Promise<CodegraphStoreStat>>()
const codegraphCli = vi.fn<(projectRoot: string, action: 'init' | 'index') => Promise<unknown>>()
const fsStat = vi.fn<(...args: unknown[]) => Promise<unknown>>()
const readMcpConfig = vi.fn<() => Promise<{ servers: Record<string, unknown> }>>(
  async () => ({ servers: {} }),
)
const writeMcpConfig = vi.fn<() => Promise<void>>(async () => {})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: vi.fn<() => boolean>(() => true),
    codegraphStoreStat,
    codegraphCli,
    fsStat,
    readMcpConfig,
    writeMcpConfig,
  }),
)

const loadConfigs = vi.fn<(root: string) => Promise<void>>(async () => {})
const startServer = vi.fn<() => Promise<void>>(async () => {})

vi.mock('@/composables/use-mcp-servers', () => ({
  default: () => ({
    loadConfigs,
    startServer,
  }),
}))

const getStatus = vi.fn<() => Promise<{ status: string }>>(async () => ({
  status: 'connected',
}))

vi.mock('@/services/mcp/mcp-runtime', () => ({
  default: {
    getStatus,
  },
}))

vi.mock('@/services/config/vixl-config', () => ({
  loadProjectSettings: vi.fn<() => Promise<Record<string, unknown>>>(async () => ({})),
  saveSettings: vi.fn<() => Promise<void>>(async () => {}),
}))

vi.mock('@/services/mcp/mcp-trust', () => ({
  sessionTrusts: new Map(),
}))

const storeStat = (dbExists: boolean): CodegraphStoreStat => ({
  storeDir: '/Users/aidan/Library/Application Support/vixl/graphs/abc',
  dbExists,
  graphId: 'a'.repeat(64),
})

describe('ensureCodeGraph', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getStatus.mockResolvedValue({ status: 'connected' })
    readMcpConfig.mockResolvedValue({ servers: {} })
  })

  it('probes the user graph store and skips init when the db exists', async () => {
    codegraphStoreStat.mockResolvedValue(storeStat(true))
    const ensureCodeGraph = (await import('@/services/codegraph/ensure-codegraph')).default

    await ensureCodeGraph('/project')

    expect(codegraphStoreStat).toHaveBeenCalledWith('/project')
    expect(codegraphCli).not.toHaveBeenCalled()
    expect(fsStat).not.toHaveBeenCalled()
  })

  it('runs codegraph init when the store db is missing', async () => {
    codegraphStoreStat.mockResolvedValue(storeStat(false))
    codegraphCli.mockResolvedValue({ ok: true, stdout: '', stderr: '' })
    const ensureCodeGraph = (await import('@/services/codegraph/ensure-codegraph')).default

    await ensureCodeGraph('/project-missing')

    expect(codegraphStoreStat).toHaveBeenCalledWith('/project-missing')
    expect(codegraphCli).toHaveBeenCalledWith('/project-missing', 'init')
    expect(fsStat).not.toHaveBeenCalled()
  })
})
