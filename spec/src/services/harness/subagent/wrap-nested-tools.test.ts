import { describe, expect, it } from 'vitest'
import wrapNestedTools from '@/services/harness/subagent/wrap-nested-tools'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const TOKEN_CAP = 8000
const CHAR_CAP = TOKEN_CAP * 4

const wrapExecute = (result: unknown) => {
  const wrapped = wrapNestedTools({
    edit_file: {
      execute: async () => result,
    },
  })
  const execute = wrapped.edit_file?.execute
  if (!execute) {
    throw new Error('expected wrapped execute')
  }
  return execute
}

describe('wrapNestedTools output capping', () => {
  it('passes a small result through unchanged', async () => {
    const result = { ok: true, path: 'src/a.ts', operation: 'edit', added: 1, removed: 1 }
    const execute = wrapExecute(result)
    const output = await execute()
    expect(output).toBe(result)
  })

  it('caps a large result to a serialized preview', async () => {
    const result = {
      ok: true,
      body: 'x'.repeat(CHAR_CAP + 4000),
    }
    const execute = wrapExecute(result)
    const output = await execute()
    const serialized = JSON.stringify(result)

    expect(estimateTextTokens(serialized)).toBeGreaterThan(TOKEN_CAP)
    expect(output).not.toBe(result)
    expect(output).toEqual({
      truncated: true,
      preview: serialized.slice(0, CHAR_CAP),
      originalChars: serialized.length,
    })
  })

  it('no longer reattaches diffs into the model-facing output', async () => {
    const result = {
      ok: true,
      body: 'x'.repeat(CHAR_CAP + 4000),
      diffs: [{ path: 'src/a.ts', operation: 'update', hunks: [] }],
    }
    const execute = wrapExecute(result)
    const output = (await execute()) as Record<string, unknown>

    expect(output.truncated).toBe(true)
    expect(output).not.toHaveProperty('diffs')
  })
})
