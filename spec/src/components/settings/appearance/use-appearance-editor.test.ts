import { describe, expect, it } from 'vitest'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'
import type { VixlThemeDefinition } from '@/types/appearance/theme'
import {
  useAppearanceEditor,
  type AppearanceEditorSection,
} from '@/components/settings/appearance/use-appearance-editor'

const makeTheme = (overrides: Partial<VixlThemeDefinition> = {}): VixlThemeDefinition => ({
  ...structuredClone(builtInVixlTheme),
  id: 'my-theme',
  name: 'My Theme',
  version: 1,
  ...overrides,
})

describe('use-appearance-editor', () => {
  it('creates a draft from a source theme with a provided id', () => {
    const editor = useAppearanceEditor()
    editor.beginCreate(builtInVixlTheme, 'untitled-theme', 'dark')

    expect(editor.isEditing.value).toBe(true)
    expect(editor.mode.value).toBe('create')
    expect(editor.draft.value?.id).toBe('untitled-theme')
    expect(editor.draft.value?.name).toBe('Untitled theme')
    // Editing target defaults to the provided (resolved) variant.
    expect(editor.editingVariant.value).toBe('dark')
    // A create draft starts clean; typing dirties it.
    expect(editor.isDirty.value).toBe(false)
    expect(editor.isDraftValid.value).toBe(true)
  })

  it('edits saved themes in place but copies the built-in theme', () => {
    const editor = useAppearanceEditor()

    editor.beginEdit(makeTheme(), 'copy-of-my-theme')
    expect(editor.mode.value).toBe('edit')
    expect(editor.draft.value?.id).toBe('my-theme')
    editor.cancel()

    editor.beginEdit(builtInVixlTheme, 'copy-of-default')
    expect(editor.mode.value).toBe('create')
    expect(editor.draft.value?.id).toBe('copy-of-default')
  })

  it('duplicates a theme preserving values but not identity', () => {
    const editor = useAppearanceEditor()
    editor.beginDuplicate(makeTheme(), 'my-theme-copy')

    expect(editor.mode.value).toBe('duplicate')
    expect(editor.draft.value?.id).toBe('my-theme-copy')
    expect(editor.draft.value?.name).toBe('My Theme copy')
    expect(editor.draft.value?.variants.light.colors).toEqual(
      builtInVixlTheme.variants.light.colors,
    )
  })

  it('tracks dirty state against the baseline', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    expect(editor.isDirty.value).toBe(false)
    editor.setToken('primary', '#112233')
    expect(editor.isDirty.value).toBe(true)
    expect(editor.draft.value?.variants.light.colors.primary).toBe('#112233')
    // The stored theme is untouched while editing.
    expect(builtInVixlTheme.variants.light.colors.primary).not.toBe('#112233')
  })

  it('marks drafts with invalid colors as invalid', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    expect(editor.isDraftValid.value).toBe(true)
    editor.setToken('background', 'not-a-color')
    expect(editor.isDraftValid.value).toBe(false)
  })

  it('updates typography with schema-safe clamping', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    editor.setTypography({ uiFontSize: 40 })
    expect(editor.draft.value?.variants.light.typography.uiFontSize).toBe(32)
    editor.setTypography({ editorFontSize: 14.4 })
    expect(editor.draft.value?.variants.light.typography.editorFontSize).toBe(14.5)
  })

  it('normalizes structured gradient canvases', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    editor.setCanvas({
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 450,
          stops: [
            { color: '#ffffff', position: 100 },
            { color: '#000000', position: 0 },
          ],
        },
      ],
    })
    expect(editor.draft.value?.variants.light.canvas).toEqual({
      fallback: '#101018',
      layers: [
        {
          kind: 'linear',
          angle: 90,
          stops: [
            { color: '#000000', position: 0 },
            { color: '#ffffff', position: 100 },
          ],
        },
      ],
    })
  })

  it('normalizes radial and conic layers and caps the layer count', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    const layer = {
      kind: 'linear' as const,
      angle: 0,
      stops: [
        { color: '#111111', position: 0 },
        { color: '#222222', position: 100 },
      ],
    }
    editor.setCanvas({
      fallback: '#101018',
      layers: [
        { kind: 'radial', x: -10, y: 150, size: 'closest-side', stops: layer.stops },
        { kind: 'conic', angle: 405, x: 120, y: -5, stops: layer.stops },
        layer,
        layer,
        layer,
        layer,
      ],
    })

    const canvas = editor.draft.value?.variants.light.canvas
    expect(canvas?.layers).toHaveLength(4)
    expect(canvas?.layers[0]).toEqual({
      kind: 'radial',
      x: 0,
      y: 100,
      size: 'closest-side',
      stops: layer.stops,
    })
    expect(canvas?.layers[1]).toEqual({
      kind: 'conic',
      angle: 45,
      x: 100,
      y: 0,
      stops: layer.stops,
    })
  })

  it('switches the editing variant and resets it to built-in defaults', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    // Edit the light variant, then switch targets.
    editor.setToken('primary', '#010203')
    editor.setVariant('dark')
    expect(editor.editingVariant.value).toBe('dark')

    editor.resetVariant()
    // Reset only touches the currently edited (dark) variant.
    expect(editor.draft.value?.variants.dark.colors).toEqual(builtInVixlTheme.variants.dark.colors)
    // The untouched variant keeps its edits.
    editor.setVariant('light')
    expect(editor.draft.value?.variants.light.colors.primary).toBe('#010203')
  })

  it('renames drafts within the schema limit', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')

    editor.rename('  Night\tOwl  ')
    expect(editor.draft.value?.name).toBe('Night Owl')

    editor.rename('x'.repeat(200))
    expect(editor.draft.value?.name.length ?? 0).toBeLessThanOrEqual(64)
  })

  it('clears draft state on cancel', () => {
    const editor = useAppearanceEditor()
    editor.beginEdit(makeTheme(), 'unused')
    editor.cancel()

    expect(editor.isEditing.value).toBe(false)
    expect(editor.draft.value).toBeNull()
    expect(editor.isDirty.value).toBe(false)
  })

  describe('setGlass', () => {
    it('stores sanitized glass on the edited variant and dirties the draft', () => {
      const editor = useAppearanceEditor()
      editor.beginEdit(makeTheme(), 'unused')

      const before = editor.draft.value?.variants.light.glass
      editor.setGlass({
        enabled: true,
        scopes: ['overlays', 'sidebar', 'overlays'],
        surfaceOpacity: 70,
        blur: 16,
        saturation: 130,
        borderOpacity: 70,
        shadow: 'medium',
        radius: 'lg',
      })

      expect(editor.isDirty.value).toBe(true)
      const glass = editor.draft.value?.variants.light.glass
      expect(glass).not.toEqual(before)
      expect(glass?.scopes).toEqual(['sidebar', 'overlays'])
      expect(glass?.enabled).toBe(true)
      // The dark variant is untouched.
      expect(editor.draft.value?.variants.dark.glass).toEqual(before)
    })

    it('clamps out-of-range glass values before storing', () => {
      const editor = useAppearanceEditor()
      editor.beginEdit(makeTheme(), 'unused')

      editor.setGlass({
        enabled: true,
        scopes: ['panels'],
        surfaceOpacity: 400,
        blur: 500,
        saturation: 20,
        borderOpacity: -8,
        shadow: 'medium',
        radius: 'md',
      })

      const glass = editor.draft.value?.variants.light.glass
      expect(glass?.surfaceOpacity).toBe(100)
      expect(glass?.blur).toBe(48)
      expect(glass?.saturation).toBe(100)
      expect(glass?.borderOpacity).toBe(0)
    })
  })

  describe('resetSection', () => {
    it('restores only the requested section of the edited variant', () => {
      const editor = useAppearanceEditor()
      editor.beginEdit(makeTheme(), 'unused')

      // Dirty every section of the light variant.
      editor.setToken('primary', '#a1b2c3')
      editor.setTypography({ uiFontSize: 20 })
      editor.setCanvas({
        fallback: '#101018',
        layers: [
          {
            kind: 'linear',
            angle: 180,
            stops: [
              { color: '#ffffff', position: 0 },
              { color: '#000000', position: 100 },
            ],
          },
        ],
      })
      editor.setGlass({
        enabled: true,
        scopes: ['panels'],
        surfaceOpacity: 70,
        blur: 16,
        saturation: 130,
        borderOpacity: 70,
        shadow: 'medium',
        radius: 'lg',
      })
      editor.setIcons({ pack: 'tabler', weight: 2.5, sizeScale: 1.5, tint: '#ff0000' })
      expect(editor.isDirty.value).toBe(true)

      editor.resetSection('colors')
      const light = editor.draft.value?.variants.light
      const defaults = builtInVixlTheme.variants.light
      expect(light?.colors).toEqual(defaults.colors)
      // Other sections keep their edits; the dark variant is untouched.
      expect(light?.typography.uiFontSize).toBe(20)
      expect(light?.canvas.layers).toHaveLength(1)
      expect(light?.glass.enabled).toBe(true)
      expect(light?.icons.pack).toBe('tabler')
      expect(editor.draft.value?.variants.dark.colors).toEqual(
        builtInVixlTheme.variants.dark.colors,
      )
      expect(editor.isDirty.value).toBe(true)
    })

    it('resets every supported section to the built-in defaults', () => {
      const sections: AppearanceEditorSection[] = [
        'colors',
        'typography',
        'background',
        'glass',
        'icons',
      ]
      const actualFor = (section: AppearanceEditorSection, editor: ReturnType<typeof useAppearanceEditor>) => {
        const light = editor.draft.value?.variants.light
        switch (section) {
          case 'colors':
            return light?.colors
          case 'typography':
            return light?.typography
          case 'background':
            return light?.canvas
          case 'glass':
            return light?.glass
          case 'icons':
            return light?.icons
        }
      }
      const defaultsFor = (section: AppearanceEditorSection) => {
        const defaults = builtInVixlTheme.variants.light
        switch (section) {
          case 'colors':
            return defaults.colors
          case 'typography':
            return defaults.typography
          case 'background':
            return defaults.canvas
          case 'glass':
            return defaults.glass
          case 'icons':
            return defaults.icons
        }
      }
      for (const section of sections) {
        const editor = useAppearanceEditor()
        editor.beginEdit(makeTheme(), 'unused')
        editor.resetSection(section)
        expect(actualFor(section, editor)).toEqual(defaultsFor(section))
      }
    })

    it('respects the editing variant and no-ops without a draft', () => {
      const editor = useAppearanceEditor()
      editor.beginEdit(makeTheme(), 'unused')
      editor.setVariant('dark')
      editor.setToken('primary', '#a1b2c3')
      editor.resetSection('colors')
      expect(editor.draft.value?.variants.dark.colors).toEqual(
        builtInVixlTheme.variants.dark.colors,
      )

      const idle = useAppearanceEditor()
      expect(() => idle.resetSection('colors')).not.toThrow()
      expect(idle.draft.value).toBeNull()
    })
  })
})
