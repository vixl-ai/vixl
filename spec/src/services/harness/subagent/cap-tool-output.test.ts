import { describe, expect, it } from 'vitest'
import capToolOutput from '@/services/harness/subagent/cap-tool-output'
import wrapNestedTools from '@/services/harness/subagent/wrap-nested-tools'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const TOKEN_CAP = 8000
const CHAR_CAP = TOKEN_CAP * 4

const hugeGrepResult = () => {
  const line = 'x'.repeat(6000)
  return {
    matches: Array.from({ length: 200 }, (_, i) => ({
      path: `file-${i}.ts`,
      lineNumber: i + 1,
      line,
    })),
    truncated: false,
  }
}

describe('capToolOutput', () => {
  it('returns a small object unchanged', () => {
    const small = { ok: true, count: 3 }
    expect(capToolOutput(small)).toBe(small)
  })

  it('shrinks a grep-like object with 200 huge matches', () => {
    const original = hugeGrepResult()
    const capped = capToolOutput(original) as {
      matches: unknown[]
      truncated: boolean
      matchCount: number
    }

    expect(capped).not.toBe(original)
    expect(capped.truncated).toBe(true)
    expect(capped.matchCount).toBe(200)
    expect(capped.matches.length).toBeGreaterThan(0)
    expect(capped.matches.length).toBeLessThan(200)
    expect(estimateTextTokens(JSON.stringify(capped))).toBeLessThanOrEqual(TOKEN_CAP)
  })

  it('truncates a string over the token cap', () => {
    const value = 'a'.repeat(CHAR_CAP + 4000)
    expect(capToolOutput(value)).toEqual({
      content: 'a'.repeat(CHAR_CAP),
      truncated: true,
      originalChars: CHAR_CAP + 4000,
    })
  })
})

describe('wrapNestedTools', () => {
  it('caps execute return values and forwards execute args', async () => {
    const received: unknown[][] = []
    const original = hugeGrepResult()
    const wrapped = wrapNestedTools({
      grep: {
        description: 'Search workspace with ripgrep',
        inputSchema: { type: 'object' },
        execute: async (...args: never[]) => {
          received.push(args)
          return original
        },
      },
      catalog: {
        description: 'No execute',
      },
    })

    expect(wrapped.catalog).toEqual({ description: 'No execute' })
    const grep = wrapped.grep
    if (!grep) {
      throw new Error('expected wrapped grep tool')
    }
    expect(grep.description).toBe('Search workspace with ripgrep')
    expect(grep.inputSchema).toEqual({ type: 'object' })

    const input = { pattern: 'TODO' }
    const options = { toolCallId: 'call-1' }
    const execute = grep.execute
    expect(execute).toBeTypeOf('function')
    if (!execute) {
      throw new Error('expected grep execute')
    }
    const result = await execute(...([input, options] as never[]))

    expect(received).toEqual([[input, options]])
    expect(result).toMatchObject({
      truncated: true,
      matchCount: 200,
    })
    expect(estimateTextTokens(JSON.stringify(result))).toBeLessThanOrEqual(TOKEN_CAP)
  })
})
