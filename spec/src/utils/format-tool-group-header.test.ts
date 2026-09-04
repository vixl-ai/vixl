import { describe, expect, it } from 'vitest'
import formatToolGroupHeader from '@/utils/format-tool-group-header'
import formatToolRunLabel from '@/utils/format-tool-run-label'
import type { ToolRun } from '@/types/harness/tool-run'

const toolRun = (partial: Partial<ToolRun> & Pick<ToolRun, 'name'>): ToolRun => ({
  toolCallId: 'call-1',
  status: 'done',
  ...partial,
})

describe('formatToolGroupHeader', () => {
  it('uses Using when a mixed group has one running child, with Edited vs Editing labels', () => {
    const tools: ToolRun[] = [
      toolRun({
        toolCallId: 'call-1',
        name: 'edit_file',
        status: 'done',
        args: { path: 'src/a.ts' },
      }),
      toolRun({
        toolCallId: 'call-2',
        name: 'write_file',
        status: 'done',
        args: { path: 'src/b.ts' },
      }),
      toolRun({
        toolCallId: 'call-3',
        name: 'edit_file',
        status: 'running',
        args: { path: 'src/c.ts' },
      }),
    ]

    expect(formatToolGroupHeader(tools)).toBe('Using 3 tools')
    expect(formatToolRunLabel(tools[0]!)).toBe('Edited a.ts')
    expect(formatToolRunLabel(tools[1]!)).toBe('Edited b.ts')
    expect(formatToolRunLabel(tools[2]!)).toBe('Editing c.ts')
  })

  it('returns Used N tools when all children are done even if the parent turn is still streaming', () => {
    expect(
      formatToolGroupHeader([
        toolRun({
          toolCallId: 'call-1',
          name: 'read_file',
          status: 'done',
          args: { path: 'src/a.ts' },
        }),
        toolRun({
          toolCallId: 'call-2',
          name: 'edit_file',
          status: 'done',
          args: { path: 'src/b.ts' },
        }),
      ]),
    ).toBe('Used 2 tools')
  })

  it('counts tool calls not unique file paths', () => {
    expect(
      formatToolGroupHeader([
        toolRun({
          toolCallId: 'call-1',
          name: 'edit_file',
          status: 'running',
          args: { path: 'src/a.ts' },
        }),
        toolRun({
          toolCallId: 'call-2',
          name: 'write_file',
          status: 'running',
          args: { path: 'src/a.ts' },
        }),
      ]),
    ).toBe('Using 2 tools')
  })

  it('treats error and rejected as not-running when no sibling is running', () => {
    expect(
      formatToolGroupHeader([
        toolRun({
          toolCallId: 'call-1',
          name: 'edit_file',
          status: 'error',
          args: { path: 'src/a.ts' },
        }),
        toolRun({
          toolCallId: 'call-2',
          name: 'write_file',
          status: 'rejected',
          args: { path: 'src/b.ts' },
        }),
        toolRun({
          toolCallId: 'call-3',
          name: 'read_file',
          status: 'done',
          args: { path: 'src/c.ts' },
        }),
      ]),
    ).toBe('Used 3 tools')
  })

  it('returns Used 0 tools for an empty group', () => {
    expect(formatToolGroupHeader([])).toBe('Used 0 tools')
  })
})
