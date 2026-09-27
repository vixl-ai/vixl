import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ModelCatalogOptionsPanel from '@/components/models/options/ModelCatalogOptionsPanel.vue'
import { Select } from '@/components/ui/select'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

const capability: ReasoningCapability = {
  supported: false,
  levels: [],
  mandatory: false,
  defaultLevel: 'medium',
}

const reasoningCapability: ReasoningCapability = {
  supported: true,
  levels: ['provider-default', 'none', 'low', 'medium', 'high'],
  mandatory: false,
  defaultLevel: 'medium',
}

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

describe('ModelCatalogOptionsPanel cost display', () => {
  it('shows icon rates instead of the compact pricing hint', () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: {},
        capability,
        meta: {
          vision: true,
          toolCalling: true,
          pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
        },
      },
    })

    expect(wrapper.find('[aria-label="Vision"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Tools"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Vision, Tools')
    expect(wrapper.text()).toContain('$2.50')
    expect(wrapper.text()).toContain('$10.00')
    expect(wrapper.text()).not.toContain('$2.50 in / $10.00 out per 1M')
  })

  it('keeps context and output hint lines when token selects are hidden', () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: {},
        capability,
        meta: {
          contextWindow: 100_000,
          maxOutputTokens: 4_096,
        },
      },
    })

    expect(wrapper.text()).toContain('Context 100k')
    expect(wrapper.text()).toContain('Max output 4,096')
    expect(wrapper.text()).not.toContain('Context window')
  })

  it('omits context and output hint lines when token selects are shown', () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: {},
        capability,
        meta: {
          contextWindow: 1_000_000,
          maxOutputTokens: 32_768,
          vision: true,
        },
      },
    })

    expect(wrapper.text()).toContain('Context window')
    expect(wrapper.text()).toContain('Max output')
    expect(wrapper.find('[aria-label="Vision"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Context 1M')
  })

  it('updates icon rates when the saved option changes', async () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: { fast: false },
        capability,
        supportsFast: true,
        meta: {
          pricing: { inputPerMillion: 2.5, outputPerMillion: 10 },
          fastPricing: { inputPerMillion: 4.5, outputPerMillion: 22.5 },
        },
      },
    })

    expect(wrapper.text()).toContain('$2.50')

    await wrapper.setProps({ option: { fast: true } })
    await nextTick()

    expect(wrapper.text()).toContain('$4.50')
    expect(wrapper.text()).toContain('$22.50')
  })

  it('shows Brain and Zap from the same capability view as the former row', async () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: { reasoning: 'high', fast: true },
        capability: reasoningCapability,
        supportsFast: true,
        meta: { vision: true },
      },
    })

    expect(wrapper.find('[aria-label="Reasoning: high"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Fast on"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('high')
  })
})

describe('ModelCatalogOptionsPanel reasoning select', () => {
  it('preselects the model default and marks that item', () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      attachTo: document.body,
      props: {
        option: {},
        capability: reasoningCapability,
      },
    })

    const html = wrapper.html() + document.body.innerHTML
    expect(html).toContain('Medium (default)')
    expect(html).not.toContain('value="provider-default"')
    expect(wrapper.text()).not.toMatch(/(?:^|\s)Default(?:\s|$)/)
  })

  it('emits provider-default when the user selects the model default', async () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: { reasoning: 'high' },
        capability: reasoningCapability,
      },
    })

    const select = wrapper.findComponent(Select)
    await select.vm.$emit('update:modelValue', 'medium')
    await nextTick()

    expect(wrapper.emitted('change')).toEqual([[{ reasoning: 'provider-default' }]])
  })

  it('emits the chosen level when it is not the model default', async () => {
    wrapper = mount(ModelCatalogOptionsPanel, {
      props: {
        option: {},
        capability: reasoningCapability,
      },
    })

    const select = wrapper.findComponent(Select)
    await select.vm.$emit('update:modelValue', 'high')
    await nextTick()

    expect(wrapper.emitted('change')).toEqual([[{ reasoning: 'high' }]])
  })
})
