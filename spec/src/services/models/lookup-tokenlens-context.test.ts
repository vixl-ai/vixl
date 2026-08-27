import { describe, expect, it, vi } from 'vitest'

const { getContext } = vi.hoisted(() => ({
  getContext: vi.fn<(args: { modelId: string }) => {
    maxInput?: number
    maxTotal?: number
  }>(),
}))

vi.mock('tokenlens', () => ({
  getContext,
}))

import lookupTokenlensContext from '@/services/models/lookup-tokenlens-context'

describe('lookupTokenlensContext', () => {
  it('returns maxInput when present', () => {
    getContext.mockReset()
    getContext.mockReturnValue({ maxInput: 50_000, maxTotal: 60_000 })
    expect(lookupTokenlensContext('gpt-4o')).toBe(50_000)
  })

  it('returns maxTotal when maxInput is missing', () => {
    getContext.mockReset()
    getContext.mockReturnValue({ maxTotal: 60_000 })
    expect(lookupTokenlensContext('gpt-4o')).toBe(60_000)
  })

  it('returns undefined when tokenlens throws', () => {
    getContext.mockReset()
    getContext.mockImplementation(() => {
      throw new Error('unknown model')
    })
    expect(lookupTokenlensContext('unknown-model')).toBeUndefined()
  })

  it('returns undefined for empty modelId', () => {
    getContext.mockReset()
    expect(lookupTokenlensContext('')).toBeUndefined()
    expect(getContext).not.toHaveBeenCalled()
  })
})
