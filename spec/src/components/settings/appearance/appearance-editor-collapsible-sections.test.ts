import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import AppearanceThemeEditor from '@/components/settings/appearance/AppearanceThemeEditor.vue'
import { builtInVixlTheme } from '@/constants/appearance/built-in-theme'

const COLLAPSIBLE_SECTIONS: Array<{ section: string; title: string; probe: string }> = [
  {
    section: 'typography',
    title: 'Typography',
    probe: '#appearance-ui-font',
  },
  {
    section: 'background',
    title: 'Canvas background',
    probe: '[role="group"][aria-label="Canvas background presets"]',
  },
  {
    section: 'glass',
    title: 'Glass surfaces',
    probe: '[data-testid="appearance-glass-editor"]',
  },
  {
    section: 'icons',
    title: 'Icons',
    probe: '[data-testid="appearance-icon-editor"]',
  },
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

describe('AppearanceThemeEditor collapsible sections', () => {
  let wrapper: VueWrapper | undefined

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
  })

  it('renders a trigger for every collapsible section', async () => {
    wrapper = await mountEditor()
    for (const { section, title } of COLLAPSIBLE_SECTIONS) {
      const trigger = wrapper.find(`[data-testid="appearance-editor-section-${section}-trigger"]`)
      expect(trigger.exists()).toBe(true)
      expect(trigger.text()).toContain(title)
      expect(trigger.attributes('aria-expanded')).toBe('false')
    }
  })

  it('collapses section bodies by default to keep the editor compact', async () => {
    wrapper = await mountEditor()
    for (const { probe } of COLLAPSIBLE_SECTIONS) {
      expect(wrapper.find(probe).exists()).toBe(false)
    }
    expect(
      wrapper.find('[data-testid="appearance-editor-advanced-trigger"]').attributes(
        'aria-expanded',
      ),
    ).toBe('false')
  })

  it('expands a section when its trigger is clicked and reveals its fields', async () => {
    wrapper = await mountEditor()
    const trigger = wrapper.find('[data-testid="appearance-editor-section-typography-trigger"]')
    await trigger.trigger('click')
    await nextTick()

    expect(trigger.attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('#appearance-ui-font').exists()).toBe(true)
  })

  it('keeps section reset controls clickable while collapsed', async () => {
    wrapper = await mountEditor()
    for (const { section } of COLLAPSIBLE_SECTIONS) {
      const reset = wrapper.find(`[data-testid="appearance-reset-${section}"]`)
      expect(reset.exists()).toBe(true)
      await reset.trigger('click')
    }
    expect(wrapper.emitted('reset-section')).toEqual(
      COLLAPSIBLE_SECTIONS.map(({ section }) => [section]),
    )
  })

  it('keeps core semantic colors always visible', async () => {
    wrapper = await mountEditor()
    expect(wrapper.text()).toContain('Semantic colors')
    expect(wrapper.find('[data-testid="appearance-reset-colors"]').exists()).toBe(true)
  })
})
