import { describe, expect, it } from 'vitest'
import { InvalidToolInputError, NoSuchToolError, type ToolSet } from 'ai'
import repairToolCall from '@/services/harness/orchestrator/repair-tool-call'

const tools: ToolSet = {}

const inputSchema = async () => ({ type: 'object' as const })

const invalidInput = (toolInput: string, toolName = 'read_file') =>
  new InvalidToolInputError({
    toolInput,
    toolName,
    cause: new SyntaxError('Unexpected end of JSON input'),
  })

const repair = (
  input: string,
  error: InvalidToolInputError | NoSuchToolError,
  extra?: {
    toolCallId?: string
    toolName?: string
    providerExecuted?: boolean
    providerMetadata?: { openai: { itemId: string } }
    dynamic?: boolean
  },
) =>
  repairToolCall({
    toolCall: {
      type: 'tool-call',
      toolCallId: extra?.toolCallId ?? 'call-1',
      toolName: extra?.toolName ?? 'read_file',
      input,
      providerExecuted: extra?.providerExecuted,
      providerMetadata: extra?.providerMetadata,
      dynamic: extra?.dynamic,
    },
    tools,
    inputSchema,
    messages: [],
    instructions: undefined,
    system: undefined,
    error,
  })

describe('repairToolCall', () => {
  it('heals truncated JSON missing closing braces', async () => {
    const input = '{"path":"a.ts"'
    const result = await repair(input, invalidInput(input))

    expect(result).not.toBeNull()
    expect(result?.input).toBe('{"path":"a.ts"}')
    expect(JSON.parse(result!.input)).toEqual({ path: 'a.ts' })
  })

  it('heals trailing commas', async () => {
    const input = '{"path":"a.ts",}'
    const result = await repair(input, invalidInput(input))

    expect(result?.input).toBe('{"path":"a.ts"}')
    expect(JSON.parse(result!.input)).toEqual({ path: 'a.ts' })
  })

  it('heals single quotes', async () => {
    const input = "{'path':'a.ts'}"
    const result = await repair(input, invalidInput(input))

    expect(result?.input).toBe('{"path":"a.ts"}')
    expect(JSON.parse(result!.input)).toEqual({ path: 'a.ts' })
  })

  it('heals unquoted keys', async () => {
    const input = '{path:"a.ts"}'
    const result = await repair(input, invalidInput(input))

    expect(result?.input).toBe('{"path":"a.ts"}')
    expect(JSON.parse(result!.input)).toEqual({ path: 'a.ts' })
  })

  it('returns null for valid JSON that would fail schema validation', async () => {
    const input = '{"path": 123}'
    const result = await repair(input, invalidInput(input))

    expect(result).toBeNull()
  })

  it('returns null for NoSuchToolError', async () => {
    const input = '{"path":"a.ts"'
    const result = await repair(
      input,
      new NoSuchToolError({
        toolName: 'missing_tool',
        availableTools: ['read_file'],
      }),
    )

    expect(result).toBeNull()
  })

  it('returns null for empty or garbage input that cannot become valid JSON', async () => {
    expect(await repair('', invalidInput(''))).toBeNull()
    expect(await repair('{:', invalidInput('{:'))).toBeNull()
    expect(await repair('}', invalidInput('}'))).toBeNull()
  })

  it('preserves toolCallId, toolName, and other toolCall fields', async () => {
    const input = '{"path":"a.ts"'
    const result = await repair(input, invalidInput(input, 'write_file'), {
      toolCallId: 'tc-42',
      toolName: 'write_file',
      providerExecuted: true,
      providerMetadata: { openai: { itemId: 'item-9' } },
      dynamic: true,
    })

    expect(result).toEqual({
      type: 'tool-call',
      toolCallId: 'tc-42',
      toolName: 'write_file',
      input: '{"path":"a.ts"}',
      providerExecuted: true,
      providerMetadata: { openai: { itemId: 'item-9' } },
      dynamic: true,
    })
  })
})
