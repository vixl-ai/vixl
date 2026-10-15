import { describe, expect, it } from 'vitest'
import {
  REASONING_REVEAL_CHARS_PER_FRAME,
  nextRevealedReasoning,
} from '@/utils/next-revealed-reasoning'

describe('nextRevealedReasoning', () => {
  it('takes a word-bounded slice when shown is empty and the target is longer than 120', () => {
    const target = `${'alpha '.repeat(16)}partialwordcontinues past the budget with extra words`
    const revealed = nextRevealedReasoning('', target)

    expect(revealed.length).toBeLessThanOrEqual(REASONING_REVEAL_CHARS_PER_FRAME)
    expect(revealed.endsWith(' ')).toBe(true)
    expect(target.startsWith(revealed)).toBe(true)
    expect(revealed).toBe(`${'alpha '.repeat(16)}partialwordcontinues `)
    expect(revealed.includes('past')).toBe(false)
  })

  it('takes exactly 120 when a word is longer than 120', () => {
    const target = 'a'.repeat(200)
    const revealed = nextRevealedReasoning('', target)

    expect(revealed).toBe('a'.repeat(REASONING_REVEAL_CHARS_PER_FRAME))
    expect(revealed.length).toBe(120)
  })

  it('stays put when shown already equals the target', () => {
    const target = 'already complete thought'

    expect(nextRevealedReasoning(target, target)).toBe(target)
  })

  it('finishes the string when only a short remainder is left', () => {
    const target = 'short remainder done'
    const shown = target.slice(0, 10)

    expect(nextRevealedReasoning(shown, target)).toBe(target)
  })
})
