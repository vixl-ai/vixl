import { describe, expect, it } from 'vitest'
import type { AgentStep } from '@/types/chat/agent-step'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { HarnessEvent } from '@/types/harness/harness-event'
import applyHydrateSubagentEvent from '@/composables/chat-store/hydrate-apply-subagent-event'
import {
  appendSubagentToolEvent,
  upsertSubagentStart,
} from '@/composables/chat-store/timeline'
import applySubagentToolEvent from '@/utils/apply-subagent-tool-event'
import applySubagentStepEvent, {
  applySubagentItemEvent,
} from '@/utils/apply-subagent-step-event'

const liveEvents: HarnessEvent[] = [
  { type: 'step-start', stepId: 's1' },
  { type: 'reasoning-delta', delta: 'Hel', stepId: 's1' },
  { type: 'reasoning-delta', delta: 'lo', stepId: 's1' },
  { type: 'reasoning-duration', stepId: 's1', seconds: 2 },
  { type: 'text-delta', delta: 'Hi', stepId: 's1' },
  { type: 'text-delta', delta: ' there', stepId: 's1' },
  {
    type: 'tool-start',
    toolCallId: 't1',
    name: 'read_file',
    args: { path: 'a.ts' },
  },
  { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
  {
    type: 'step-content',
    stepId: 's1',
    reasoning: 'Hello',
    reasoningSeconds: 2,
    text: 'Hi there',
  },
  { type: 'step-finish', stepId: 's1' },
]

const hydrateEvents: HarnessEvent[] = [
  { type: 'step-start', stepId: 's1' },
  {
    type: 'tool-start',
    toolCallId: 't1',
    name: 'read_file',
    args: { path: 'a.ts' },
  },
  { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
  {
    type: 'step-content',
    stepId: 's1',
    reasoning: 'Hello',
    reasoningSeconds: 2,
    text: 'Hi there',
  },
  { type: 'step-finish', stepId: 's1' },
]

const applySequence = (events: HarnessEvent[]): AgentStep[] => {
  let steps: AgentStep[] = []
  for (const event of events) {
    steps = applySubagentStepEvent(steps, event)
  }
  return steps
}

const started = (): ChatTimelineItem[] =>
  upsertSubagentStart([], {
    subagentId: 'sub-1',
    name: 'explore',
    blocking: false,
  })

const liveItem = (events: HarnessEvent[]): ChatTimelineItem[] => {
  let items = started()
  for (const event of events) {
    items = appendSubagentToolEvent(items, 'sub-1', event)
  }
  return items
}

const hydrateItem = (events: HarnessEvent[]): ChatTimelineItem[] => {
  const items = started()
  for (const event of events) {
    applyHydrateSubagentEvent(items, 0, event)
  }
  return items
}

const subagentOf = (items: ChatTimelineItem[]) => {
  const item = items[0]
  if (item?.type !== 'subagent') {
    throw new Error('expected subagent item')
  }
  return item
}

describe('applySubagentStepEvent', () => {
  it('replaces accumulated deltas when step-content arrives', () => {
    const steps = applySequence(liveEvents)
    expect(steps).toHaveLength(1)
    expect(steps[0]?.id).toBe('s1')
    expect(steps[0]?.reasoning).toBe('Hello')
    expect(steps[0]?.text).toBe('Hi there')
    expect(steps[0]?.reasoningSeconds).toBe(2)
    expect(steps[0]?.tools).toEqual([
      {
        toolCallId: 't1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { ok: true },
        artifact: undefined,
        diffs: undefined,
      },
    ])
  })

  it('matches hydrate-only step-content to the live delta sequence', () => {
    expect(applySequence(hydrateEvents)).toEqual(applySequence(liveEvents))
  })

  it('ignores deltas when no step has been opened', () => {
    expect(
      applySubagentStepEvent([], {
        type: 'reasoning-delta',
        delta: 'nope',
        stepId: 'missing',
      }),
    ).toEqual([])
    expect(
      applySubagentStepEvent([], {
        type: 'text-delta',
        delta: 'nope',
        stepId: 'missing',
      }),
    ).toEqual([])
  })

  it('falls back to the last open step when stepId is unknown', () => {
    const opened = applySubagentStepEvent([], {
      type: 'step-start',
      stepId: 's1',
    })
    const next = applySubagentStepEvent(opened, {
      type: 'reasoning-delta',
      delta: 'think',
      stepId: 'unknown',
    })
    expect(next[0]?.reasoning).toBe('think')
  })

  it('does not attach tool events when there is no open step', () => {
    expect(
      applySubagentStepEvent([], {
        type: 'tool-start',
        toolCallId: 't1',
        name: 'read_file',
        args: { path: 'a.ts' },
      }),
    ).toEqual([])
  })
})

describe('applySubagentItemEvent live and hydrate', () => {
  it('keeps the flat tools list in sync with step tools', () => {
    let item = subagentOf(started())
    for (const event of liveEvents) {
      item = applySubagentItemEvent(item, event)
    }
    expect(item.tools).toEqual(item.steps?.[0]?.tools)
    expect(item.tools).toHaveLength(1)
  })

  it('produces the same item from appendSubagentToolEvent and hydrate replay', () => {
    const live = subagentOf(liveItem(liveEvents))
    const hydrated = subagentOf(hydrateItem(hydrateEvents))
    expect(hydrated.steps).toEqual(live.steps)
    expect(hydrated.tools).toEqual(live.tools)
  })

  it('leaves tools unchanged for nested step events', () => {
    const tools = applySubagentToolEvent([], {
      type: 'step-start',
      stepId: 's1',
    })
    expect(tools).toEqual([])
    const afterContent = applySubagentToolEvent(tools, {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'x',
      reasoningSeconds: 1,
      text: 'y',
    })
    expect(afterContent).toEqual([])
  })
})

describe('step-drop-unsealed', () => {
  const sealedThenOrphan: HarnessEvent[] = [
    { type: 'step-start', stepId: 's1' },
    {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    },
    { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
    {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'Hello',
      reasoningSeconds: 2,
      text: 'Hi there',
    },
    { type: 'step-finish', stepId: 's1' },
    { type: 'step-start', stepId: 's2' },
    {
      type: 'tool-start',
      toolCallId: 't2',
      name: 'grep',
      args: { query: 'auth' },
    },
    { type: 'step-drop-unsealed', stepIds: ['s2'] },
  ]

  it('drops unsealed steps and tools that only exist on them', () => {
    let item = subagentOf(started())
    for (const event of sealedThenOrphan) {
      item = applySubagentItemEvent(item, event)
    }
    expect(item.steps).toHaveLength(1)
    expect(item.steps?.[0]?.id).toBe('s1')
    expect(item.steps?.[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.tools[0]?.status).toBe('done')
  })

  it('keeps sealed steps when applySubagentStepEvent drops by id', () => {
    const afterStart = applySequence([
      { type: 'step-start', stepId: 's1' },
      { type: 'step-start', stepId: 's2' },
    ])
    expect(afterStart.map((step) => step.id)).toEqual(['s1', 's2'])
    expect(
      applySubagentStepEvent(afterStart, {
        type: 'step-drop-unsealed',
        stepIds: ['s2'],
      }).map((step) => step.id),
    ).toEqual(['s1'])
  })

  it('is a no-op when stepIds is empty', () => {
    const opened = applySubagentStepEvent([], {
      type: 'step-start',
      stepId: 's1',
    })
    expect(
      applySubagentStepEvent(opened, {
        type: 'step-drop-unsealed',
        stepIds: [],
      }),
    ).toBe(opened)
  })

  it('keeps tools that also exist on a sealed step', () => {
    const shared = {
      toolCallId: 't-shared',
      name: 'read_file',
      status: 'done' as const,
      args: { path: 'a.ts' },
    }
    const orphanOnly = {
      toolCallId: 't-orphan',
      name: 'grep',
      status: 'running' as const,
      args: { query: 'auth' },
    }
    const item = applySubagentItemEvent(
      {
        ...subagentOf(started()),
        tools: [shared, orphanOnly],
        steps: [
          {
            id: 's1',
            text: 'kept',
            reasoning: '',
            tools: [shared],
          },
          {
            id: 's2',
            text: '',
            reasoning: '',
            tools: [shared, orphanOnly],
          },
        ],
      },
      { type: 'step-drop-unsealed', stepIds: ['s2'] },
    )
    expect(item.steps?.map((step) => step.id)).toEqual(['s1'])
    expect(item.tools.map((tool) => tool.toolCallId)).toEqual(['t-shared'])
    expect(item.steps?.[0]?.tools.map((tool) => tool.toolCallId)).toEqual([
      't-shared',
    ])
  })

  it('matches live append and hydrate replay for a drop event', () => {
    const live = subagentOf(liveItem(sealedThenOrphan))
    const hydrated = subagentOf(hydrateItem(sealedThenOrphan))
    expect(hydrated.steps).toEqual(live.steps)
    expect(hydrated.tools).toEqual(live.tools)
    expect(live.steps?.map((step) => step.id)).toEqual(['s1'])
    expect(live.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
  })
})

describe('applySubagentItemEvent out-of-order tool before step-start', () => {
  const inOrder: HarnessEvent[] = [
    { type: 'step-start', stepId: 's1' },
    {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    },
    { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
    {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'Hello',
      reasoningSeconds: 2,
      text: 'Hi there',
    },
    { type: 'step-finish', stepId: 's1' },
  ]

  const outOfOrder: HarnessEvent[] = [
    {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    },
    { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
    { type: 'step-start', stepId: 's1' },
    {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'Hello',
      reasoningSeconds: 2,
      text: 'Hi there',
    },
    { type: 'step-finish', stepId: 's1' },
  ]

  const applyItem = (events: HarnessEvent[]) => {
    let item = subagentOf(started())
    for (const event of events) {
      item = applySubagentItemEvent(item, event)
    }
    return item
  }

  it('adopts unclaimed flat tools into the step after a late step-start', () => {
    const item = applyItem(outOfOrder)
    expect(applySequence(outOfOrder)[0]?.tools).toEqual([])
    expect(item.steps?.[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.steps?.[0]?.tools).toEqual(item.tools)
    expect(subagentOf(hydrateItem(outOfOrder)).steps?.[0]?.tools).toEqual(
      item.steps?.[0]?.tools,
    )
  })

  it('does not change in-order replay versus applySubagentStepEvent', () => {
    const item = applyItem(inOrder)
    expect(item.steps).toEqual(applySequence(inOrder))
    expect(item.tools).toEqual(item.steps?.[0]?.tools)
  })

  it('does not steal prior-step tools when a later step starts', () => {
    const item = applyItem([
      ...inOrder,
      { type: 'step-start', stepId: 's2' },
    ])
    expect(item.steps?.map((step) => step.id)).toEqual(['s1', 's2'])
    expect(item.steps?.[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.steps?.[1]?.tools).toEqual([])
  })
})

describe('applySubagentItemEvent missing step-start before step-content', () => {
  const inOrder: HarnessEvent[] = [
    { type: 'step-start', stepId: 's1' },
    {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    },
    { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
    {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'Hello',
      reasoningSeconds: 2,
      text: 'Hi there',
    },
    { type: 'step-finish', stepId: 's1' },
  ]

  const missingStepStart: HarnessEvent[] = [
    {
      type: 'tool-start',
      toolCallId: 't1',
      name: 'read_file',
      args: { path: 'a.ts' },
    },
    { type: 'tool-result', toolCallId: 't1', result: { ok: true } },
    {
      type: 'step-content',
      stepId: 's1',
      reasoning: 'Hello',
      reasoningSeconds: 2,
      text: 'Hi there',
    },
    { type: 'step-finish', stepId: 's1' },
  ]

  const applyItem = (events: HarnessEvent[]) => {
    let item = subagentOf(started())
    for (const event of events) {
      item = applySubagentItemEvent(item, event)
    }
    return item
  }

  it('adopts unclaimed flat tools into the sealed step when step-start is missing', () => {
    const item = applyItem(missingStepStart)
    expect(applySequence(missingStepStart)[0]?.tools).toEqual([])
    expect(item.steps).toHaveLength(1)
    expect(item.steps?.[0]?.id).toBe('s1')
    expect(item.steps?.[0]?.text).toBe('Hi there')
    expect(item.steps?.[0]?.reasoning).toBe('Hello')
    expect(item.steps?.[0]?.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.tools.map((tool) => tool.toolCallId)).toEqual(['t1'])
    expect(item.steps?.[0]?.tools).toEqual(item.tools)
    expect(subagentOf(hydrateItem(missingStepStart)).steps?.[0]?.tools).toEqual(
      item.steps?.[0]?.tools,
    )
  })

  it('is a no-op for in-order live and hydrate sequences', () => {
    const live = applyItem(inOrder)
    const hydrated = subagentOf(hydrateItem(inOrder))
    expect(live.steps).toEqual(applySequence(inOrder))
    expect(hydrated.steps).toEqual(live.steps)
    expect(hydrated.tools).toEqual(live.tools)
    expect(live.steps?.[0]?.tools).toEqual(live.tools)
  })
})
