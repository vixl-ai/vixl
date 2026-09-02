import { describe, expect, it } from 'vitest'
import type { SubagentTimelineItem } from '@/types/chat/chat-timeline-item'
import deriveSubagentActivity from '@/utils/derive-subagent-activity'

const base = (
  partial: Partial<SubagentTimelineItem> & Pick<SubagentTimelineItem, 'status' | 'tools'>,
): SubagentTimelineItem => ({
  type: 'subagent',
  subagentId: 'sub-1',
  name: 'Exploring app',
  blocking: false,
  compactions: [],
  ...partial,
})

describe('deriveSubagentActivity', () => {
  it('returns null when not running', () => {
    expect(
      deriveSubagentActivity(
        base({
          status: 'done',
          tools: [
            {
              toolCallId: 't1',
              name: 'read_file',
              status: 'done',
              args: { path: 'a.ts' },
            },
          ],
        }),
      ),
    ).toBeNull()
  })

  it('returns Working when running with no tools yet', () => {
    expect(
      deriveSubagentActivity(
        base({
          status: 'running',
          tools: [],
        }),
      ),
    ).toBe('Working')
  })

  it('prefers the latest running tool label', () => {
    expect(
      deriveSubagentActivity(
        base({
          status: 'running',
          tools: [
            {
              toolCallId: 't1',
              name: 'list_dir',
              status: 'done',
              args: { path: '.' },
            },
            {
              toolCallId: 't2',
              name: 'read_file',
              status: 'running',
              args: { path: 'app/pages/index.vue' },
            },
          ],
        }),
      ),
    ).toBe('Reading app/pages/index.vue…')
  })

  it('returns Compacting while the subagent is compacting', () => {
    expect(
      deriveSubagentActivity(
        base({
          status: 'running',
          compacting: true,
          tools: [
            {
              toolCallId: 't1',
              name: 'read_file',
              status: 'running',
              args: { path: 'a.ts' },
            },
          ],
        }),
      ),
    ).toBe('Compacting')
  })

  it('falls back to the last tool when none are running', () => {
    expect(
      deriveSubagentActivity(
        base({
          status: 'running',
          tools: [
            {
              toolCallId: 't1',
              name: 'grep',
              status: 'done',
              args: { pattern: 'todo' },
            },
          ],
        }),
      ),
    ).toBe('Searched todo')
  })
})
