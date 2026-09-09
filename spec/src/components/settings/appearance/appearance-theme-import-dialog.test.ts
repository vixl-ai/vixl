import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick, ref } from 'vue'
import AppearanceThemeImportDialog from '@/components/settings/appearance/AppearanceThemeImportDialog.vue'
import { describeThemeFile } from '@/services/appearance/theme-file-utils'
import type { ThemeFilePayload } from '@/schemas/appearance/theme-file'

const tokens = {} as ThemeFilePayload['variants']['light']['tokens']
const editor = {} as ThemeFilePayload['variants']['light']['editor']

const glassOff = {
  enabled: false,
  scopes: [],
  surfaceOpacity: 100,
  blur: 0,
  saturation: 100,
  borderOpacity: 0,
  shadow: 'none' as const,
  radius: 'none' as const,
}

const glassOn = {
  ...glassOff,
  enabled: true,
  scopes: ['sidebar', 'overlays'] as Array<'sidebar' | 'panels' | 'overlays'>,
  surfaceOpacity: 60,
  blur: 16,
  saturation: 130,
  borderOpacity: 25,
  shadow: 'subtle' as const,
  radius: 'md' as const,
}

const payload = (): ThemeFilePayload => ({
  format: 'vixl-theme',
  version: 2,
  id: 'aurora-dusk',
  name: 'Aurora Dusk',
  typography: {
    uiFontFamily: 'Inter Variable',
    monoFontFamily: 'JetBrains Mono',
    uiFontSize: 13,
    editorFontSize: 13,
  },
  variants: {
    light: {
      tokens,
      editor,
      background: {
        fallback: '#f8fafc',
        layers: [
          {
            kind: 'linear',
            angle: 180,
            stops: [
              { color: '#f8fafc', position: 0 },
              { color: '#e2e8f0', position: 100 },
            ],
          },
          {
            kind: 'radial',
            x: 25,
            y: 20,
            size: 'closest-side',
            stops: [
              { color: '#c7d2fe', position: 0 },
              { color: '#f8fafc00', position: 100 },
            ],
          },
        ],
      },
      glass: glassOn,
      icons: { pack: 'tabler', weight: 1.5, sizeScale: 1, tint: 'inherit' },
    },
    dark: {
      tokens,
      editor,
      background: { fallback: '#0b0b12', layers: [] },
      glass: glassOff,
      icons: { pack: 'phosphor', weight: 2, sizeScale: 1.1, tint: 'inherit' },
    },
  },
})

const mountDialog = async (props: {
  summary: ReturnType<typeof describeThemeFile> | null
  renamedFromId: string | null
}): Promise<VueWrapper> => {
  const Host = defineComponent({
    components: { AppearanceThemeImportDialog },
    setup() {
      const open = ref(true)
      return { open, ...props }
    },
    template: `
      <AppearanceThemeImportDialog
        :open="open"
        :summary="summary"
        :renamed-from-id="renamedFromId"
        :activate="true"
        :importing="false"
      />
    `,
  })
  const wrapper = mount(Host, { attachTo: document.body })
  await nextTick()
  return wrapper
}

describe('AppearanceThemeImportDialog v2 summary', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  const bodyText = (): string => document.body.textContent ?? ''

  it('renders layered canvas, glass scopes, and icon packs per variant', async () => {
    wrapper = await mountDialog({ summary: describeThemeFile(payload()), renamedFromId: null })
    const text = bodyText()

    // Canvas: layer counts and kinds per variant.
    expect(text).toContain('light: 2 gradient layer(s) (linear, radial) over #f8fafc')
    expect(text).toContain('dark: solid over #0b0b12')
    // Glass: enabled scopes per variant, off when disabled.
    expect(text).toContain('light: sidebar, overlays')
    expect(text).toContain('dark: off')
    // Icon packs per variant.
    expect(text).toContain('light: tabler')
    expect(text).toContain('dark: phosphor')
  })

  it('explains a collision-forced id rename while keeping the name', async () => {
    wrapper = await mountDialog({
      summary: { ...describeThemeFile(payload()), id: 'aurora-dusk-2' },
      renamedFromId: 'aurora-dusk',
    })
    const text = bodyText()
    expect(text).toContain('Id aurora-dusk is already in use')
    expect(text).toContain('aurora-dusk-2')
    expect(text).toContain('Aurora Dusk')
  })

  it('renders nothing when there is no summary', async () => {
    wrapper = await mountDialog({ summary: null, renamedFromId: null })
    expect(bodyText()).not.toContain('Aurora Dusk')
    expect(bodyText()).not.toContain('Gradient')
  })
})
