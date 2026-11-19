import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { defaultVixlSettings } from '@/schemas/vixl-settings'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const { writeSettings } = vi.hoisted(() => ({
  writeSettings:
    vi.fn<
      (scope: string, settings: Record<string, unknown>, rootPath?: string | null) => Promise<void>
    >(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    writeSettings,
  }),
)

import { saveSettings } from '@/services/config/vixl-config'

const settingsWith = (theme: 'light' | 'dark'): VixlSettings => ({
  ...defaultVixlSettings(),
  'appearance.theme': theme,
})

describe('saveSettings write queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('serializes overlapping writes to the same scope in call order', async () => {
    const order: string[] = []
    let releaseFirst: (() => void) | undefined
    writeSettings.mockImplementation(async (_scope, settings) => {
      const theme = settings['appearance.theme'] as string
      order.push(`start:${theme}`)
      if (theme === 'light') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      order.push(`end:${theme}`)
    })

    const first = saveSettings('personal', settingsWith('light'))
    const second = saveSettings('personal', settingsWith('dark'))

    await vi.waitFor(() => {
      expect(order).toEqual(['start:light'])
    })
    // The second write must not start while the first is still in flight.
    expect(writeSettings).toHaveBeenCalledTimes(1)

    releaseFirst?.()
    await Promise.all([first, second])

    expect(order).toEqual(['start:light', 'end:light', 'start:dark', 'end:dark'])
  })

  it('keeps the queue usable after a failed write', async () => {
    writeSettings.mockRejectedValueOnce(new Error('disk full'))
    writeSettings.mockResolvedValueOnce(undefined)

    await expect(saveSettings('personal', settingsWith('light'))).rejects.toThrow('disk full')
    await expect(saveSettings('personal', settingsWith('dark'))).resolves.toBeUndefined()
    expect(writeSettings).toHaveBeenCalledTimes(2)
  })
})