import { beforeEach, describe, expect, it, vi } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

const updateSetting = vi.hoisted(() =>
  vi.fn<(tab: string, key: string, value: unknown) => Promise<void>>(),
)

const settingsRecord = vi.hoisted(() => ({
  value: {
    version: 1 as const,
    'appearance.theme': 'system' as const,
  } as Record<string, unknown> & { version: 1 },
}))

vi.mock('@/composables/use-vixl-config', () => ({
  default: () => ({
    effectiveSettings: settingsRecord,
    updateSetting: (tab: string, key: string, value: unknown) => {
      settingsRecord.value = { ...settingsRecord.value, [key]: value }
      return updateSetting(tab, key, value)
    },
  }),
}))

import { useAppearanceThemes } from '@/components/settings/appearance/use-appearance-themes'

const makeTheme = (id: string, name = 'My Theme'): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id,
  name,
  version: 2,
})

const setStoredState = (themeLibrary: VixlThemeDefinition[], customThemeId?: string) => {
  settingsRecord.value = {
    ...settingsRecord.value,
    'appearance.themeLibrary': themeLibrary,
    'appearance.activeThemeId': customThemeId,
  } as typeof settingsRecord.value
}

describe('use-appearance-themes', () => {
  beforeEach(() => {
    updateSetting.mockReset()
    updateSetting.mockResolvedValue(undefined)
    settingsRecord.value = { version: 1, 'appearance.theme': 'system' }
  })

  it('falls back to the built-in theme when nothing is stored', () => {
    const themes = useAppearanceThemes()
    expect(themes.themes.value).toEqual([])
    expect(themes.activeTheme.value).toEqual(builtInVixlTheme)
    expect(themes.isBuiltInActive.value).toBe(true)
  })

  it('saves a valid theme and activates it via settings writes', async () => {
    setStoredState([])
    const themes = useAppearanceThemes()
    const saved = await themes.saveTheme(makeTheme('nightfall', 'Nightfall'), {
      activate: true,
    })

    expect(saved).toBe(true)
    expect(updateSetting).toHaveBeenCalledWith(
      'personal',
      'appearance.themeLibrary',
      expect.arrayContaining([expect.objectContaining({ id: 'nightfall', name: 'Nightfall' })]),
    )
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', 'nightfall')
    // The active id points at a theme that exists in the persisted library.
    expect(settingsRecord.value['appearance.activeThemeId']).toBe('nightfall')
    expect(
      (settingsRecord.value['appearance.themeLibrary'] as VixlThemeDefinition[]).some(
        (theme) => theme.id === 'nightfall',
      ),
    ).toBe(true)
  })

  it('rejects themes that fail the strict schema', async () => {
    const themes = useAppearanceThemes()
    const invalid = makeTheme('bad-theme')
    invalid.variants.light.colors.background = 'url(https://evil.example)'
    expect(await themes.saveTheme(invalid)).toBe(false)
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('never persists the built-in theme into the library', async () => {
    const themes = useAppearanceThemes()
    expect(await themes.saveTheme(structuredClone(builtInVixlTheme))).toBe(false)
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('removes themes and clears a dangling active id', async () => {
    setStoredState([makeTheme('nightfall')], 'nightfall')
    const themes = useAppearanceThemes()

    expect(await themes.removeTheme('nightfall')).toBe(true)
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.themeLibrary', [])
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', undefined)
  })

  it('refuses to delete unknown or built-in themes', async () => {
    setStoredState([makeTheme('nightfall')])
    const themes = useAppearanceThemes()

    expect(await themes.removeTheme('does-not-exist')).toBe(false)
    expect(await themes.removeTheme('vixl-default')).toBe(false)
    expect(updateSetting).not.toHaveBeenCalled()
  })

  it('renames saved themes while preserving the id', async () => {
    setStoredState([makeTheme('nightfall', 'Nightfall')], 'nightfall')
    const themes = useAppearanceThemes()

    expect(await themes.renameTheme('nightfall', 'Midnight')).toBe(true)
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.themeLibrary', [
      expect.objectContaining({ id: 'nightfall', name: 'Midnight' }),
    ])
  })

  it('generates collision-safe ids derived from the name', () => {
    setStoredState([makeTheme('nightfall')])
    const themes = useAppearanceThemes()

    expect(themes.generateThemeId('Deep Ocean')).toBe('deep-ocean')
    expect(themes.generateThemeId('Nightfall!')).toBe('nightfall-2')
    // The built-in id is always reserved.
    expect(themes.generateThemeId('Vixl Default')).not.toBe('vixl-default')
  })

  it('ignores unknown selections and keeps the built-in fallback', async () => {
    setStoredState([makeTheme('nightfall')])
    const themes = useAppearanceThemes()

    await themes.setActiveTheme('ghost-theme')
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', undefined)

    await themes.setActiveTheme('nightfall')
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', 'nightfall')
  })

  it('selects curated bundled themes without adding them to the library', async () => {
    setStoredState([], 'midnight-aurora')
    const themes = useAppearanceThemes()

    // The curated definition resolves by id even though the library is empty.
    expect(themes.activeTheme.value.id).toBe('midnight-aurora')
    expect(themes.activeTheme.value.name).toBe('Midnight Aurora')
    expect(themes.isBuiltInActive.value).toBe(true)
    expect(themes.themes.value).toEqual([])

    await themes.setActiveTheme('midnight-aurora')
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', 'midnight-aurora')

    // Selecting the built-in default clears the stored id.
    await themes.setActiveTheme('vixl-default')
    expect(updateSetting).toHaveBeenCalledWith('personal', 'appearance.activeThemeId', undefined)
  })

  it('refuses to persist curated built-in themes into the library', async () => {
    const themes = useAppearanceThemes()
    const bundled = structuredClone(builtInVixlTheme)
    bundled.id = 'midnight-aurora'
    bundled.name = 'Midnight Aurora'
    expect(await themes.saveTheme(bundled)).toBe(false)
    expect(updateSetting).not.toHaveBeenCalled()
    expect(await themes.renameTheme('nordic-frost', 'Renamed')).toBe(false)
  })
})
