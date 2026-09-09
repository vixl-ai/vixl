import { describe, expect, it } from 'vitest'
import {
  defaultVixlSettings,
  migrateVixlSettings,
  validateVixlSettings,
} from '@/schemas/vixl-settings'
import {
  PERSONAL_ONLY_PROJECT_KEYS,
  isPersonalOnlyProjectKey,
  stripPersonalOnlyProjectOverrides,
} from '@/services/config/merge-settings'
import { BUILTIN_VIXL_THEME_ID } from '@/types/appearance/theme'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import type { VixlThemeDefinition } from '@/types/appearance/theme'

const customTheme = (): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id: 'nightfall',
  name: 'Nightfall',
})

describe('vixl settings appearance defaults', () => {
  it('defaults the theme library to empty and the color mode to system', () => {
    const settings = defaultVixlSettings()
    expect(settings['appearance.theme']).toBe('system')
    expect(settings['appearance.themeLibrary']).toEqual([])
    expect(settings['appearance.activeThemeId']).toBeUndefined()
  })

  it('migrates legacy settings that only know the color mode', () => {
    const migrated = migrateVixlSettings({ version: 1, 'appearance.theme': 'dark' })
    expect(migrated['appearance.theme']).toBe('dark')
    expect(migrated['appearance.themeLibrary']).toEqual([])
  })

  it('persists a valid custom theme library and active id', () => {
    const validated = validateVixlSettings({
      ...defaultVixlSettings(),
      'appearance.activeThemeId': 'nightfall',
      'appearance.themeLibrary': [customTheme()],
    })
    expect(validated).toMatchObject({
      success: true,
      data: { 'appearance.themeLibrary': [expect.objectContaining({ id: 'nightfall' })] },
    })
  })

  it('drops invalid theme library entries during migration', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'appearance.activeThemeId': 'nightfall',
      'appearance.themeLibrary': [{ id: 'broken', name: '' }, customTheme()],
    })
    expect(migrated['appearance.themeLibrary']?.map((theme) => theme.id)).toEqual([
      'nightfall',
    ])
    expect(migrated['appearance.activeThemeId']).toBe('nightfall')
  })

  it('removes a dangling active id so the built-in theme resolves', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'appearance.activeThemeId': 'deleted',
      'appearance.themeLibrary': [customTheme()],
    })
    expect(migrated['appearance.activeThemeId']).toBeUndefined()
  })

  it('rejects a library entry with unknown fields', () => {
    const theme = customTheme()
    const validated = validateVixlSettings({
      ...defaultVixlSettings(),
      'appearance.themeLibrary': [{ ...theme, surprise: true }],
    })
    expect(validated.success).toBe(false)
  })
})

describe('appearance personal-only project keys', () => {
  it('marks theme library keys as personal-only', () => {
    expect(isPersonalOnlyProjectKey('appearance.themeLibrary')).toBe(true)
    expect(isPersonalOnlyProjectKey('appearance.activeThemeId')).toBe(true)
    expect(PERSONAL_ONLY_PROJECT_KEYS).not.toContain('appearance.theme')
  })

  it('keeps the color mode project-overridable for backward compatibility', () => {
    expect(isPersonalOnlyProjectKey('appearance.theme')).toBe(false)
  })

  it('strips theme keys from project overrides but keeps the color mode', () => {
    const stripped = stripPersonalOnlyProjectOverrides({
      version: 1,
      'appearance.theme': 'dark',
      'appearance.activeThemeId': 'nightfall',
      'appearance.themeLibrary': [customTheme()],
      'agent.sandbox.enabled': false,
    } as never)

    expect(stripped['appearance.theme']).toBe('dark')
    expect(stripped['appearance.activeThemeId']).toBeUndefined()
    expect('appearance.themeLibrary' in stripped).toBe(false)
    expect(stripped['agent.sandbox.enabled']).toBe(false)
  })

  it('never allows a project to activate the built-in id as a stored theme', () => {
    const theme = customTheme()
    const validated = validateVixlSettings({
      ...defaultVixlSettings(),
      'appearance.themeLibrary': [{ ...theme, id: BUILTIN_VIXL_THEME_ID }],
    })
    expect(validated.success).toBe(false)
  })
})
