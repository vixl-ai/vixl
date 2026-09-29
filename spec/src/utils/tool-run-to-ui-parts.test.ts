import { describe, expect, it } from 'vitest'
import { convertToModelMessages } from 'ai'
import type { AgentStep } from '@/types/chat/agent-step'
import type { ToolRun } from '@/types/harness/tool-run'
import toolRunToUiParts from '@/utils/tool-run-to-ui-parts'

const RESULT_CHAR_CAP = 8000

const run = (partial: Partial<ToolRun> & Pick<ToolRun, 'name' | 'toolCallId'>): ToolRun => ({
  status: 'done',
  ...partial,
})

const stepWithTools = (
  tools: ToolRun[],
  partial: Partial<Pick<AgentStep, 'id' | 'text' | 'reasoning'>> = {},
): AgentStep => ({
  id: partial.id ?? 'step-1',
  text: partial.text ?? '',
  reasoning: partial.reasoning ?? '',
  tools,
})

describe('toolRunToUiParts', () => {
  it('maps done tools to output-available dynamic-tool parts', () => {
    const args = { path: 'src/foo.ts' }
    const result = { content: 'ok' }
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-1',
          name: 'read_file',
          args,
          result,
        }),
      ]),
    )

    expect(parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: args,
        output: result,
      },
    ])
  })

  it('maps error and rejected tools to output-error with derived errorText', () => {
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-err',
          name: 'grep',
          status: 'error',
          args: { pattern: 'TODO' },
          result: { error: 'File not found' },
        }),
        run({
          toolCallId: 'tc-rej',
          name: 'write_file',
          status: 'rejected',
          args: { path: 'a.ts' },
          result: { error: 'User rejected the write' },
        }),
      ]),
    )

    expect(parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'grep',
        toolCallId: 'tc-err',
        state: 'output-error',
        input: { pattern: 'TODO' },
        errorText: 'File not found',
      },
      {
        type: 'dynamic-tool',
        toolName: 'write_file',
        toolCallId: 'tc-rej',
        state: 'output-error',
        input: { path: 'a.ts' },
        errorText: 'User rejected the write',
      },
    ])
  })

  it('maps running tools to output-error with a did-not-complete message', () => {
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-open',
          name: 'read_file',
          status: 'running',
          args: { path: 'a.ts' },
          result: { content: 'partial' },
        }),
      ]),
    )

    expect(parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-open',
        state: 'output-error',
        input: { path: 'a.ts' },
        errorText: 'Tool did not complete',
      },
    ])
  })

  it('caps projected results at 8000 chars with an elision marker', () => {
    const extra = 50
    const long = 'x'.repeat(RESULT_CHAR_CAP + extra)
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-long',
          name: 'read_file',
          args: { path: 'big.ts' },
          result: long,
        }),
      ]),
    )

    const toolPart = parts[1]
    expect(toolPart).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-available',
      input: { path: 'big.ts' },
    })
    if (toolPart?.type !== 'dynamic-tool' || toolPart.state !== 'output-available') {
      return
    }
    expect(typeof toolPart.output).toBe('string')
    const output = toolPart.output as string
    expect(output.startsWith('x'.repeat(RESULT_CHAR_CAP))).toBe(true)
    expect(output.endsWith(`... [elided ${extra} chars]`)).toBe(true)
    expect(output.length).toBe(RESULT_CHAR_CAP + `... [elided ${extra} chars]`.length)
  })

  it('serializes then caps non-string results and leaves args uncapped', () => {
    const extra = 20
    const payload = 'y'.repeat(RESULT_CHAR_CAP + extra)
    const hugeArgs = { path: `src/${'a'.repeat(200)}.ts` }
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-obj',
          name: 'read_file',
          args: hugeArgs,
          result: { content: payload },
        }),
      ]),
    )

    const toolPart = parts[1]
    expect(toolPart?.type).toBe('dynamic-tool')
    if (toolPart?.type !== 'dynamic-tool' || toolPart.state !== 'output-available') {
      return
    }
    expect(toolPart.input).toEqual(hugeArgs)
    expect(typeof toolPart.output).toBe('string')
    const output = toolPart.output as string
    expect(output.includes(`... [elided `)).toBe(true)
    expect(output.length).toBeGreaterThan(RESULT_CHAR_CAP)
  })

  it('emits one step-start before a step with multiple tools', () => {
    const parts = toolRunToUiParts(
      stepWithTools(
        [
          run({
            toolCallId: 'tc-2',
            name: 'grep',
            args: { pattern: 'TODO' },
            result: { matches: 1 },
          }),
          run({
            toolCallId: 'tc-3',
            name: 'read_file',
            args: { path: 'b.ts' },
            result: { content: 'b' },
          }),
        ],
        { id: 'step-3', text: 'third' },
      ),
    )

    expect(parts.map((part) => part.type)).toEqual([
      'step-start',
      'dynamic-tool',
      'dynamic-tool',
    ])
    expect(parts[1]).toMatchObject({ toolCallId: 'tc-2', toolName: 'grep' })
    expect(parts[2]).toMatchObject({ toolCallId: 'tc-3', toolName: 'read_file' })
  })

  it('returns no parts when the step has no tool runs', () => {
    expect(
      toolRunToUiParts(
        stepWithTools([], { text: 'hello', reasoning: 'think' }),
      ),
    ).toEqual([])
  })

  it('projects undefined args as empty object input for done runs', () => {
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-trunc',
          name: 'create_plan',
          result: { title: 'partial' },
        }),
      ]),
    )

    expect(parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'create_plan',
      toolCallId: 'tc-trunc',
      state: 'output-available',
      input: {},
    })
  })

  it('projects undefined args as empty object input for error runs', () => {
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-err-trunc',
          name: 'create_plan',
          status: 'error',
          result: { error: 'truncated' },
        }),
      ]),
    )

    expect(parts[1]).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'create_plan',
      toolCallId: 'tc-err-trunc',
      state: 'output-error',
      input: {},
    })
  })

  it('preserves plain object args as input', () => {
    const args = { title: 'Ship it', body: 'Do the thing' }
    const parts = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-obj',
          name: 'create_plan',
          args,
          result: { ok: true },
        }),
      ]),
    )

    expect(parts[1]).toMatchObject({
      type: 'dynamic-tool',
      state: 'output-available',
      input: args,
    })
    if (parts[1]?.type !== 'dynamic-tool') {
      return
    }
    expect(parts[1].input).toBe(args)
  })
})

describe('convertToModelMessages with projected tool parts', () => {
  it('converts done object output into assistant tool-call plus json tool result', async () => {
    const args = { path: 'a.ts' }
    const result = { content: 'ok' }
    const projected = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-1',
          name: 'read_file',
          args,
          result,
        }),
      ]),
    )

    const modelMessages = await convertToModelMessages([
      {
        role: 'assistant',
        parts: [{ type: 'text', text: 'checking' }, ...projected],
      },
    ])

    expect(modelMessages).toEqual([
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'checking' }],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            input: args,
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'read_file',
            output: { type: 'json', value: result },
          },
        ],
      },
    ])
  })

  it('converts string output to text tool results and errorText to error-text', async () => {
    const projected = [
      ...toolRunToUiParts(
        stepWithTools([
          run({
            toolCallId: 'tc-str',
            name: 'read_file',
            args: { path: 'a.ts' },
            result: 'file body',
          }),
        ]),
      ),
      ...toolRunToUiParts(
        stepWithTools(
          [
            run({
              toolCallId: 'tc-err',
              name: 'grep',
              status: 'error',
              args: { pattern: 'x' },
              result: { error: 'nope' },
            }),
          ],
          { id: 'step-2' },
        ),
      ),
    ]

    const modelMessages = await convertToModelMessages([
      {
        role: 'assistant',
        parts: projected,
      },
    ])

    expect(modelMessages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-str',
            toolName: 'read_file',
            input: { path: 'a.ts' },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-str',
            toolName: 'read_file',
            output: { type: 'text', value: 'file body' },
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-err',
            toolName: 'grep',
            input: { pattern: 'x' },
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-err',
            toolName: 'grep',
            output: { type: 'error-text', value: 'nope' },
          },
        ],
      },
    ])
  })

  it('converts missing args into a tool-call with empty object input', async () => {
    const result = { title: 'partial' }
    const projected = toolRunToUiParts(
      stepWithTools([
        run({
          toolCallId: 'tc-trunc',
          name: 'create_plan',
          result,
        }),
      ]),
    )

    const modelMessages = await convertToModelMessages([
      {
        role: 'assistant',
        parts: projected,
      },
    ])

    expect(modelMessages).toEqual([
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-trunc',
            toolName: 'create_plan',
            input: {},
            providerExecuted: undefined,
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-trunc',
            toolName: 'create_plan',
            output: { type: 'json', value: result },
          },
        ],
      },
    ])
  })
})
