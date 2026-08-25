import { describe, expect, it } from 'vitest'
import formatToolValidationError from '@/services/harness/format-tool-validation-error'

describe('format-tool-validation-error', () => {
  it('returns null when the value is not a validation error', () => {
    expect(formatToolValidationError(new Error('tool failed'))).toBeNull()
    expect(formatToolValidationError({ code: 1 })).toBeNull()
  })

  it('formats nested AI SDK Zod issues with tool name, path, and types', () => {
    const formatted = formatToolValidationError({
      name: 'AI_InvalidToolInputError',
      toolName: 'web_fetch',
      cause: {
        name: 'AI_TypeValidationError',
        cause: {
          issues: [
            {
              expected: 'string',
              received: 'object',
              path: ['params', 'expression'],
              message: 'Expected string, received object',
            },
          ],
        },
      },
    })
    expect(formatted).toContain('Invalid input for tool web_fetch')
    expect(formatted).toContain('path: params.expression')
    expect(formatted).toContain('expected: string')
    expect(formatted).toContain('received: object')
  })
})
