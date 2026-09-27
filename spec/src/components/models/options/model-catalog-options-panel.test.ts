import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ModelCatalogOptionsPanel from '@/components/models/options/ModelCatalogOptionsPanel.vue'
import type { ReasoningCapability } from '@/services/models/resolve-reasoning-capability'

const capability: ReasoningCapability = {
  supported: false,
  levels: [],
  mandatory: false,
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

    expect(wrapper.text()).toContain('Vision, Tools')
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
    expect(wrapper.text()).toContain('Vision')
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
})
