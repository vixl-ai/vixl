import { describe, expect, it } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  deriveToolDiffs,
  filterToolsForMode,
  injectContextIntoLastUserMessage,
  mapMetaStatusToChatStatus,
  patchSubagentToolResults,
  resolveStreamError,
  resolveToolErrorMessage,
} from '@/services/harness/orchestrator/helpers'

describe('orchestrator helpers', () => {
  describe('deriveToolDiffs', () => {
    it('returns undefined for invalid payloads', () => {
      expect(deriveToolDiffs(null)).toBeUndefined()
      expect(deriveToolDiffs('x')).toBeUndefined()
      expect(deriveToolDiffs({})).toBeUndefined()
      expect(deriveToolDiffs({ diffs: [{ path: 1 }] })).toBeUndefined()
    })

    it('returns parsed diffs when valid', () => {
      const diffs = [
        {
          path: 'a.ts',
          operation: 'update' as const,
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              lines: [{ kind: 'add' as const, content: '+x' }],
            },
          ],
        },
      ]
      expect(deriveToolDiffs({ diffs })).toEqual(diffs)
    })
  })

  describe('filterToolsForMode', () => {
    const tools = {
      read_file: { description: 'r' },
      write_file: { description: 'w' },
      create_plan: { description: 'p' },
      ask_user: { description: 'a' },
    } as unknown as ReturnType<typeof import('@/services/harness/build-tools').default>

    it('keeps only tools allowed for ask mode', () => {
      expect(Object.keys(filterToolsForMode('ask', tools)).sort()).toEqual([
        'ask_user',
        'read_file',
      ])
    })

    it('keeps plan tools in plan mode', () => {
      expect(Object.keys(filterToolsForMode('plan', tools)).sort()).toEqual([
        'ask_user',
        'create_plan',
        'read_file',
      ])
    })
  })

  describe('resolveStreamError', () => {
    it('preserves Error instances and wraps other values', () => {
      const err = new Error('boom')
      expect(resolveStreamError(err)).toBe(err)
      expect(resolveStreamError('nope')).toEqual(new Error('Model stream failed'))
    })
  })

  describe('resolveToolErrorMessage', () => {
    it('stringifies tool errors', () => {
      expect(resolveToolErrorMessage(new Error('tool failed'))).toBe('tool failed')
      expect(resolveToolErrorMessage('raw')).toBe('raw')
      expect(resolveToolErrorMessage({ code: 1 })).toBe('{"code":1}')
    })

    it('includes Zod path and expected type for AI SDK validation errors', () => {
      const error = {
        name: 'AI_InvalidToolInputError',
        toolName: 'web_fetch',
        message: 'Invalid input for tool web_fetch: Type validation failed',
        cause: {
          name: 'AI_TypeValidationError',
          message: 'Type validation failed',
          cause: {
            name: 'ZodError',
            issues: [
              {
                code: 'invalid_type',
                expected: 'string',
                received: 'object',
                path: ['params', 'expression'],
                message: 'Expected string, received object',
              },
            ],
          },
        },
      }
      const message = resolveToolErrorMessage(error)
      expect(message).toContain('web_fetch')
      expect(message).toContain('params.expression')
      expect(message).toContain('expected: string')
      expect(message).toContain('received: object')
      expect(message).toContain('Expected string, received object')
    })
  })

  describe('injectContextIntoLastUserMessage', () => {
    it('returns messages unchanged when context is blank', () => {
      const messages: ModelMessage[] = [{ role: 'user', content: 'hi' }]
      expect(injectContextIntoLastUserMessage(messages, '  ')).toBe(messages)
    })

    it('prefixes the last user string message', () => {
      const messages: ModelMessage[] = [
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'hi' },
      ]
      expect(injectContextIntoLastUserMessage(messages, 'ctx')).toEqual([
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'ctx\n\nhi' },
      ])
    })

    it('prefixes an existing text part in array content', () => {
      const messages: ModelMessage[] = [
        {
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
        },
      ]
      expect(injectContextIntoLastUserMessage(messages, 'ctx')).toEqual([
        {
          role: 'user',
          content: [{ type: 'text', text: 'ctx\n\nhi' }],
        },
      ])
    })

    it('inserts a text part when array content has none', () => {
      const messages: ModelMessage[] = [
        {
          role: 'user',
          content: [{ type: 'file', mediaType: 'text/plain', data: 'x' }],
        },
      ]
      const result = injectContextIntoLastUserMessage(messages, 'ctx')
      expect(result[0]).toMatchObject({
        role: 'user',
        content: [
          { type: 'text', text: 'ctx' },
          { type: 'file', mediaType: 'text/plain', data: 'x' },
        ],
      })
    })
  })

  describe('patchSubagentToolResults', () => {
    it('patches matching tool-result parts', () => {
      const messages: ModelMessage[] = [
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'task',
              output: { type: 'json', value: { pending: true } },
            },
          ],
        },
      ]
      expect(
        patchSubagentToolResults(messages, [
          {
            toolCallId: 'call-1',
            result: {
              subagentId: 's1',
              name: 'explorer',
              summary: 'done',
            },
          },
        ]),
      ).toEqual([
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call-1',
              toolName: 'task',
              output: {
                type: 'json',
                value: {
                  subagentId: 's1',
                  name: 'explorer',
                  summary: 'done',
                },
              },
            },
          ],
        },
      ])
    })
  })

  describe('mapMetaStatusToChatStatus', () => {
    it('maps meta and submit state to chat status', () => {
      expect(mapMetaStatusToChatStatus('idle', true)).toBe('submitted')
      expect(mapMetaStatusToChatStatus('running', false)).toBe('streaming')
      expect(mapMetaStatusToChatStatus('idle', false)).toBe('ready')
    })
  })
})
