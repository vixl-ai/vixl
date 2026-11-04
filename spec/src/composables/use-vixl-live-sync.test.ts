import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import type { VixlFileChange } from '@/composables/use-vixl-live-sync'
import { mockTauriEvent } from '../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'

const harness = vi.hoisted(() => ({
  refreshAll: vi.fn<() => Promise<void>>(async () => undefined),
  loadConfigs: vi.fn<(rootPath: string | null) => Promise<void>>(async () => undefined),
  refreshStates: vi.fn<(rootPath?: string | null) => Promise<void>>(async () => undefined),
  refresh: vi.fn<() => Promise<void>>(async () => undefined),
  ensureDefaultProject: vi.fn<() => Promise<void>>(async () => undefined),
}))

const trayRefreshAgents = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => undefined))
const watchVixlPaths = vi.hoisted(() =>
  vi.fn<(rootPath?: string | null) => Promise<void>>(async () => undefined),
)
const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: unknown) => Promise<() => void>>(async () => () => {}),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    trayRefreshAgents: () => trayRefreshAgents(),
    watchVixlPaths: (rootPath?: string | null) => watchVixlPaths(rootPath),
  }),
)

vi.mock('@/composables/use-vixl-config', async () => {
  const { ref } = await import('vue')
  const activeRootPath = ref<string | null>('/repo')
  return {
    default: () => ({
      activeRootPath,
      refreshAll: () => harness.refreshAll(),
    }),
  }
})

vi.mock('@/composables/use-mcp-servers', () => ({
  default: () => ({
    loadConfigs: (rootPath: string | null) => harness.loadConfigs(rootPath),
    refreshStates: (...args: [] | [string | null]) => harness.refreshStates(...args),
  }),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    refresh: () => harness.refresh(),
    ensureDefaultProject: () => harness.ensureDefaultProject(),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

let wrapper: VueWrapper | undefined

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const mountSync = async (): Promise<(change: VixlFileChange) => Promise<void>> => {
  const { default: useVixlLiveSync } = await import('@/composables/use-vixl-live-sync')
  let applyChange: ((change: VixlFileChange) => Promise<void>) | null = null
  const Host = defineComponent({
    setup() {
      applyChange = useVixlLiveSync().applyChange
      return {}
    },
    template: '<div />',
  })
  wrapper = mount(Host)
  await vi.waitFor(() => {
    expect(listen).toHaveBeenCalledTimes(1)
  })
  await flush()
  harness.refreshAll.mockClear()
  harness.loadConfigs.mockClear()
  harness.refreshStates.mockClear()
  trayRefreshAgents.mockClear()
  if (!applyChange) {
    throw new Error('applyChange was not captured')
  }
  return applyChange
}

describe('use-vixl-live-sync', () => {
  beforeEach(() => {
    harness.refreshAll.mockClear()
    harness.loadConfigs.mockClear()
    harness.refreshStates.mockClear()
    harness.refresh.mockClear()
    harness.ensureDefaultProject.mockClear()
    trayRefreshAgents.mockReset()
    trayRefreshAgents.mockResolvedValue(undefined)
    watchVixlPaths.mockReset()
    watchVixlPaths.mockResolvedValue(undefined)
    listen.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('refreshes the tray when plans change', async () => {
    const applyChange = await mountSync()
    await applyChange({ scope: 'personal', kind: 'plans' })
    expect(trayRefreshAgents).toHaveBeenCalledTimes(1)
    expect(trayRefreshAgents).toHaveBeenCalledWith()
    expect(harness.refreshAll).not.toHaveBeenCalled()
    expect(harness.loadConfigs).not.toHaveBeenCalled()
    expect(harness.refreshStates).not.toHaveBeenCalled()
  })

  it('keeps settings refresh and skips the tray', async () => {
    const applyChange = await mountSync()
    await applyChange({ scope: 'personal', kind: 'settings' })
    expect(harness.refreshAll).toHaveBeenCalledTimes(1)
    expect(trayRefreshAgents).not.toHaveBeenCalled()
    expect(harness.loadConfigs).not.toHaveBeenCalled()
  })

  it('keeps mcp refresh and skips the tray', async () => {
    const applyChange = await mountSync()
    await applyChange({ scope: 'project', kind: 'mcp', rootPath: '/repo' })
    expect(harness.loadConfigs).toHaveBeenCalledWith('/repo')
    expect(harness.refreshStates).toHaveBeenCalledWith()
    expect(harness.refreshStates).toHaveBeenCalledWith('/repo')
    expect(trayRefreshAgents).not.toHaveBeenCalled()
    expect(harness.refreshAll).not.toHaveBeenCalled()
  })

  it('does not refresh the tray for unrelated file kinds', async () => {
    const applyChange = await mountSync()
    await applyChange({ scope: 'personal', kind: 'agents' })
    await applyChange({ scope: 'project', kind: 'skills', rootPath: '/repo' })
    expect(trayRefreshAgents).not.toHaveBeenCalled()
    expect(harness.refreshAll).not.toHaveBeenCalled()
    expect(harness.loadConfigs).not.toHaveBeenCalled()
  })
})
