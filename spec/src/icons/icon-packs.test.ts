import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AppIcon from '@/icons/AppIcon.vue'
import { setSharedIconAppearance } from '@/icons/icon-appearance'
import { APP_ICON_NAMES } from '@/icons/icon-names'
import { getIconPackAdapter, ICON_PACK_ADAPTERS, resolveIconComponent } from '@/icons/resolve-icon'
import type { VixlThemeIconAppearance } from '@/types/appearance/theme'

const withAppearance = (icons: Partial<VixlThemeIconAppearance>): VixlThemeIconAppearance => ({
  pack: 'lucide',
  weight: 2,
  sizeScale: 1,
  tint: 'inherit',
  ...icons,
})

describe('icon pack adapters', () => {
  it('maps every semantic icon name in every pack', () => {
    for (const name of APP_ICON_NAMES) {
      for (const adapter of Object.values(ICON_PACK_ADAPTERS)) {
        const component = adapter.components[name]
        expect(component, `${name} missing from ${adapter.id}`).toBeTruthy()
      }
    }
  })

  it('exposes all three bundled packs', () => {
    expect(Object.keys(ICON_PACK_ADAPTERS).sort()).toEqual(['lucide', 'phosphor', 'tabler'])
  })

  it('normalizes stroke props per pack', () => {
    expect(ICON_PACK_ADAPTERS.lucide.strokeProps(1.4)).toEqual({ 'stroke-width': 1.5 })
    expect(ICON_PACK_ADAPTERS.tabler.strokeProps(1.4)).toEqual({ strokeWidth: 1.5 })
    expect(ICON_PACK_ADAPTERS.phosphor.strokeProps(1)).toEqual({ weight: 'thin' })
    expect(ICON_PACK_ADAPTERS.phosphor.strokeProps(1.5)).toEqual({ weight: 'light' })
    expect(ICON_PACK_ADAPTERS.phosphor.strokeProps(2)).toEqual({ weight: 'regular' })
    expect(ICON_PACK_ADAPTERS.phosphor.strokeProps(2.5)).toEqual({ weight: 'bold' })
    // Out-of-domain weights are clamped into the schema bounds.
    expect(ICON_PACK_ADAPTERS.lucide.strokeProps(9)).toEqual({ 'stroke-width': 2.5 })
    expect(ICON_PACK_ADAPTERS.lucide.strokeProps(0)).toEqual({ 'stroke-width': 1 })
  })

  it('falls back to Lucide for unknown packs and names', () => {
    expect(getIconPackAdapter('unknown-pack').id).toBe('lucide')
    expect(resolveIconComponent('not-a-real-name' as never, 'lucide')).toBeTruthy()
  })
})

describe('AppIcon runtime', () => {
  it('renders the active pack component with a semantic data attribute', () => {
    const wrapper = mount(AppIcon, { props: { name: 'settings' } })
    expect(wrapper.find('[data-icon="settings"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('is decorative by default (aria-hidden) and labeled when given a label', () => {
    const decorative = mount(AppIcon, { props: { name: 'search' } })
    expect(decorative.find('svg[aria-hidden="true"]').exists()).toBe(true)
    decorative.unmount()

    const labeled = mount(AppIcon, {
      props: { name: 'search', label: 'Search' },
    })
    const svg = labeled.find('svg')
    expect(svg.attributes('role')).toBe('img')
    expect(svg.attributes('aria-label')).toBe('Search')
    labeled.unmount()
  })

  it('switches components when the shared runtime pack changes', () => {
    const lucide = resolveIconComponent('settings', 'lucide')
    const tabler = resolveIconComponent('settings', 'tabler')
    const phosphor = resolveIconComponent('settings', 'phosphor')
    expect(tabler).not.toBe(lucide)
    expect(phosphor).not.toBe(tabler)

    setSharedIconAppearance(withAppearance({ pack: 'tabler' }))
    const tablerMount = mount(AppIcon, { props: { name: 'settings' } })
    expect(tablerMount.find('svg').classes()).toContain('tabler-icon-settings')
    tablerMount.unmount()

    setSharedIconAppearance(withAppearance({ pack: 'phosphor' }))
    const phosphorMount = mount(AppIcon, { props: { name: 'settings' } })
    expect(phosphorMount.find('[data-icon="settings"]').exists()).toBe(true)
    phosphorMount.unmount()

    setSharedIconAppearance(withAppearance({ pack: 'lucide' }))
  })

  it('applies normalized stroke width, scaled size, and tint from the theme', () => {
    setSharedIconAppearance(
      withAppearance({ pack: 'lucide', weight: 1.5, sizeScale: 1.5, tint: '#88aaff' }),
    )
    const wrapper = mount(AppIcon, { props: { name: 'check', size: 16 } })
    const svg = wrapper.find('svg')
    expect(svg.attributes('stroke-width')).toBe('1.5')
    expect(Number(svg.attributes('width'))).toBeCloseTo(24)
    expect(svg.attributes('style')).toContain('rgb(136, 170, 255)')
    wrapper.unmount()

    // Explicit props override the theme stroke width; with an inherit tint
    // the currentColor behavior is preserved (no inline style).
    setSharedIconAppearance(withAppearance({ pack: 'lucide' }))
    const override = mount(AppIcon, {
      props: { name: 'check', size: 16, strokeWidth: 2.5 },
    })
    expect(override.find('svg').attributes('stroke-width')).toBe('2.5')
    expect(override.find('svg').attributes('style')).toBeUndefined()
    override.unmount()
    setSharedIconAppearance(withAppearance({}))
  })
})
