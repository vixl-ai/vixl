import { describe, expect, it } from 'vitest'
import type { ToolRun } from '@/types/harness/tool-run'
import backfillSubagentStepsFromHistory from '@/utils/backfill-subagent-steps-from-history'

const tool = (toolCallId: string, name = 'read_file'): ToolRun => ({
  toolCallId,
  name,
  status: 'done',
  args: { path: `${toolCallId}.ts` },
})

describe('backfillSubagentStepsFromHistory', () => {
  it('builds steps from assistant reasoning, text, and tool-call parts', () => {
    const steps = backfillSubagentStepsFromHistory(
      'sub-1',
      [
        { role: 'user', content: 'look around' },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Need the file first.' },
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName: 'read_file',
              input: { path: 't1.ts' },
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'found things' }],
        },
      ],
      [tool('t1')],
    )

    expect(steps).toEqual([
      {
        id: 'sub-1-step-0',
        text: '',
        reasoning: 'Need the file first.',
        tools: [tool('t1')],
      },
      {
        id: 'sub-1-step-1',
        text: 'found things',
        reasoning: '',
        tools: [],
      },
    ])
  })

  it('returns no steps when assistant messages have tools but no reasoning or text', () => {
    expect(
      backfillSubagentStepsFromHistory(
        'sub-1',
        [
          {
            role: 'assistant',
            content: [
              {
                type: 'tool-call',
                toolCallId: 't1',
                toolName: 'read_file',
                input: { path: 't1.ts' },
              },
            ],
          },
        ],
        [tool('t1')],
      ),
    ).toEqual([])
  })

  it('returns no steps when there are no tools', () => {
    expect(
      backfillSubagentStepsFromHistory(
        'sub-1',
        [
          {
            role: 'assistant',
            content: [{ type: 'reasoning', text: 'thinking' }],
          },
        ],
        [],
      ),
    ).toEqual([])
  })

  it('does not invent reasoning or text for leftover tools', () => {
    const steps = backfillSubagentStepsFromHistory(
      'sub-1',
      [
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'Read it.' },
            {
              type: 'tool-call',
              toolCallId: 't1',
              toolName: 'read_file',
              input: { path: 't1.ts' },
            },
          ],
        },
      ],
      [tool('t1'), tool('t2', 'grep')],
    )

    expect(steps).toEqual([
      {
        id: 'sub-1-step-0',
        text: '',
        reasoning: 'Read it.',
        tools: [tool('t1'), tool('t2', 'grep')],
      },
    ])
  })
})
