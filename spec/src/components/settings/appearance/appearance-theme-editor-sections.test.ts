import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AppearanceThemeEditor from '@/components/settings/appearance/AppearanceThemeEditor.vue'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'

const SECTION_RESET_BUTTONS: Array<[string, string]> = [
  ['appearance-reset-colors', 'colors'],
  ['appearance-reset-typography', 'typography'],
  ['appearance-reset-background', 'background'],
  ['appearance-reset-glass', 'glass'],
  ['appearance-reset-icons', 'icons'],
]

const mountEditor = async () => {
  const wrapper = mount(AppearanceThemeEditor, {
    props: {
      draft: structuredClone(builtInVixlTheme),
      editingVariant: 'light',
      isDirty: false,
      isDraftValid: true,
    },
    attachTo: document.body,
  })
  await nextTick()
  return wrapper
}

describe('AppearanceThemeEditor section resets', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('renders a reset control for every editor section', async () => {
    wrapper = await mountEditor()
    for (const [testId] of SECTION_RESET_BUTTONS) {
      const button = wrapper.find(`[data-testid="${testId}"]`)
      expect(button.exists()).toBe(true)
      expect(button.attributes('aria-label')).toContain('Reset')
      expect(button.attributes('aria-label')).toContain('Vixl defaults')
    }
  })

  it('emits reset-section with the section key when a reset button is clicked', async () => {
    wrapper = await mountEditor()
    for (const [testId] of SECTION_RESET_BUTTONS) {
      await wrapper.find(`[data-testid="${testId}"]`).trigger('click')
    }
    expect(wrapper.emitted('reset-section')).toEqual(
      SECTION_RESET_BUTTONS.map(([, section]) => [section]),
    )
  })

  it('keeps accessible names for section reset controls unique per section', async () => {
    wrapper = await mountEditor()
    const labels = SECTION_RESET_BUTTONS.map(([testId]) =>
      wrapper?.find(`[data-testid="${testId}"]`).attributes('aria-label'),
    )
    expect(new Set(labels).size).toBe(SECTION_RESET_BUTTONS.length)
  })
})
