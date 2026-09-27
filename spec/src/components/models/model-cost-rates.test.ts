import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import ModelCostRates from '@/components/models/ModelCostRates.vue'
import type { ModelPricingRates } from '@/types/billing/model-pricing-rates'
import type { ModelCatalogMeta } from '@/types/models/model-catalog-meta'
import type { ModelCatalogOption } from '@/types/models/model-catalog-option'

const base: ModelPricingRates = {
  inputPerMillion: 2.5,
  outputPerMillion: 10,
  cacheReadPerMillion: 0.25,
  cacheWritePerMillion: 3.75,
  reasoningPerMillion: 15,
}

const fast: ModelPricingRates = {
  inputPerMillion: 4.5,
  outputPerMillion: 22.5,
}

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

const mountRates = (
  option: ModelCatalogOption,
  meta: ModelCatalogMeta,
  compact = false,
): VueWrapper => {
  wrapper = mount(ModelCostRates, {
    props: { option, meta, compact },
  })
  return wrapper
}

describe('ModelCostRates', () => {
  it('renders input, output, cache, and reasoning rates', () => {
    const mounted = mountRates({}, { pricing: base })
    expect(mounted.text()).toContain('$2.50')
    expect(mounted.text()).toContain('$10.00')
    expect(mounted.text()).toContain('$0.25')
    expect(mounted.text()).toContain('$3.75')
    expect(mounted.text()).toContain('$15.00')
    expect(mounted.find('[aria-label="Input"]').exists()).toBe(true)
    expect(mounted.find('[aria-label="Output"]').exists()).toBe(true)
    expect(mounted.find('[aria-label="Cache read"]').exists()).toBe(true)
    expect(mounted.find('[aria-label="Cache write"]').exists()).toBe(true)
    expect(mounted.find('[aria-label="Reasoning"]').exists()).toBe(true)
  })

  it('hides the reasoning rate when reasoning is none', () => {
    const mounted = mountRates({ reasoning: 'none' }, { pricing: base })
    expect(mounted.find('[aria-label="Reasoning"]').exists()).toBe(false)
    expect(mounted.text()).toContain('$2.50')
  })

  it('marks fast rates as estimated when fastPricing is missing', () => {
    const mounted = mountRates({ fast: true }, { pricing: base })
    const estimated = mounted.get('[aria-label="Estimated"]')
    expect(estimated.text()).toBe('~')
    const inputValue = mounted.get('[aria-label="Input"]').element.nextElementSibling
    expect(inputValue?.textContent).toBe('$2.50')
  })

  it('follows option.fast to the matching rates', async () => {
    const mounted = mountRates({ fast: false }, { pricing: base, fastPricing: fast })
    expect(mounted.text()).toContain('$2.50')
    expect(mounted.text()).not.toContain('$4.50')

    await mounted.setProps({ option: { fast: true } })
    await nextTick()

    expect(mounted.text()).toContain('$4.50')
    expect(mounted.text()).toContain('$22.50')
    expect(mounted.find('[aria-label="Estimated"]').exists()).toBe(false)
  })

  it('uses compact row classes when compact is set', () => {
    const mounted = mountRates({}, { pricing: base }, true)
    const root = mounted.get('div')
    expect(root.classes()).toContain('flex-nowrap')
    expect(root.classes()).toContain('text-xs')
    expect(root.classes()).not.toContain('flex-wrap')
  })

  it('renders nothing when pricing is missing', () => {
    const mounted = mountRates({}, { vision: true })
    expect(mounted.text()).toBe('')
  })
})
