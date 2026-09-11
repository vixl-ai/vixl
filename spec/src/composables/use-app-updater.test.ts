import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadEvent } from '@tauri-apps/plugin-updater'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'

type FakeUpdate = {
  version: string
  body: string
  downloadAndInstall: ReturnType<
    typeof vi.fn<(onEvent?: (event: DownloadEvent) => void) => Promise<void>>
  >
}

const check = vi.hoisted(() => vi.fn<() => Promise<FakeUpdate | null>>())
const relaunch = vi.hoisted(() =>
  vi.fn<() => Promise<void>>(async () => undefined),
)

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => check(),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => relaunch(),
}))

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const createFakeUpdate = (): FakeUpdate => ({
  version: '1.2.3',
  body: 'Release notes',
  downloadAndInstall: vi.fn<
    (onEvent?: (event: DownloadEvent) => void) => Promise<void>
  >(async () => undefined),
})

describe('use-app-updater', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('DEV', false)
    check.mockReset()
    relaunch.mockReset()
    relaunch.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('stores the check result as the same object, not a reactive proxy', async () => {
    const fakeUpdate = createFakeUpdate()
    check.mockResolvedValue(fakeUpdate)

    const { default: useAppUpdater } = await import('@/composables/use-app-updater')
    const updater = useAppUpdater()
    await updater.checkForUpdates({ silent: true })

    expect(updater.updateAvailable.value).toBe(fakeUpdate)
  })

  it('downloadAndInstall calls the update method then relaunch', async () => {
    const fakeUpdate = createFakeUpdate()
    check.mockResolvedValue(fakeUpdate)

    const { default: useAppUpdater } = await import('@/composables/use-app-updater')
    const updater = useAppUpdater()
    await updater.checkForUpdates({ silent: true })
    await updater.downloadAndInstall()

    expect(fakeUpdate.downloadAndInstall).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('sets updateAvailable to null when check resolves null', async () => {
    check.mockResolvedValue(null)

    const { default: useAppUpdater } = await import('@/composables/use-app-updater')
    const updater = useAppUpdater()
    await updater.checkForUpdates({ silent: true })

    expect(updater.updateAvailable.value).toBeNull()
  })
})
