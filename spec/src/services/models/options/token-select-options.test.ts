import { describe, expect, it } from 'vitest'
import {
  contextWindowSelectValues,
  maxOutputSelectValues,
} from '@/services/models/options/token-select-options'

describe('contextWindowSelectValues', () => {
  it('returns nothing when the model only reports one size', () => {
    expect(contextWindowSelectValues(128_000)).toEqual([])
  })

  it('offers 256k and 1M under a 1M reported window', () => {
    expect(contextWindowSelectValues(1_000_000)).toEqual([
      128_000, 256_000, 1_000_000,
    ])
  })

  it('treats a 1,048,576 window as 1M without a duplicate 1M tier', () => {
    expect(contextWindowSelectValues(1_048_576)).toEqual([
      128_000, 256_000, 1_048_576,
    ])
  })

  it('keeps a current override that is still under the reported max', () => {
    expect(contextWindowSelectValues(1_000_000, 200_000)).toEqual([
      128_000, 200_000, 256_000, 1_000_000,
    ])
  })
})

describe('maxOutputSelectValues', () => {
  it('returns nothing for a single reported output cap', () => {
    expect(maxOutputSelectValues(4_096)).toEqual([])
  })

  it('offers smaller output tiers under the reported max', () => {
    expect(maxOutputSelectValues(32_768)).toEqual([
      4_096, 8_192, 16_384, 32_768,
    ])
  })
})
