import { describe, expect, it } from 'vitest'
import applyHydrateHarnessEvent, {
  type HydrateAccumulator,
} from '@/composables/chat-store/hydrate-harness'
import {
  applyHydrateLine,
  createFlushTurn,
} from '@/composables/chat-store/hydrate-lines'
import hydrateTimelineBuilder from '@/composables/chat-store/hydrate-timeline-builder'

const emptyAcc = (): HydrateAccumulator => hydrateTimelineBuilder.createAccumulator()

const noopFlush = (): void => {}

describe('hydrate-harness subagent-start', () => {
  it('ignores a persisted description and keeps agentName', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'call-1',
        name: 'explorer',
        description: 'Scan auth helpers',
        blocking: true,
      },
      noopFlush,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.name).toBe('explorer')
    expect('description' in item).toBe(false)
  })

  it('hydrates old records without description using agentName', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-legacy',
        toolCallId: 'call-legacy',
        name: 'generalPurpose',
        blocking: false,
      },
      noopFlush,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.name).toBe('generalPurpose')
    expect('description' in item).toBe(false)
  })
})

describe('hydrate-harness todo-update', () => {
  it('replaces the last todo item instead of appending another', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'todo-update',
        todos: [{ id: 't1', content: 'one', status: 'pending' }],
      },
      noopFlush,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'todo-update',
        todos: [{ id: 't1', content: 'one done', status: 'completed' }],
      },
      noopFlush,
    )
    expect(acc.nextTimeline).toHaveLength(1)
    expect(acc.nextTimeline[0]).toEqual({
      type: 'todo',
      todos: [{ id: 't1', content: 'one done', status: 'completed' }],
    })
  })
})

describe('hydrate-harness tool-run', () => {
  it('upserts a later tool-run into the committed turn that owns the toolCallId', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        stepId: 'step-1',
      },
      flushTurn,
    )
    flushTurn()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        result: { content: 'ok' },
        stepId: 'step-2',
      },
      flushTurn,
    )
    flushTurn()

    const turns = acc.nextTimeline.filter((item) => item.type === 'agent-turn')
    expect(turns).toHaveLength(1)
    const turn = turns[0]
    expect(turn?.type).toBe('agent-turn')
    if (turn?.type !== 'agent-turn') {
      return
    }
    const tools = turn.turn.steps.flatMap((step) => step.tools)
    expect(tools).toHaveLength(1)
    expect(tools[0]).toMatchObject({
      toolCallId: 'tc-1',
      name: 'read_file',
      status: 'done',
      args: { path: 'a.ts' },
      result: { content: 'ok' },
    })
  })

  it('projects flushed tool runs onto the assistant UIMessage', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
        stepId: 'step-1',
      },
      flushTurn,
    )
    flushTurn()

    expect(acc.nextMessages).toHaveLength(1)
    expect(acc.nextMessages[0]?.parts).toEqual([
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { path: 'a.ts' },
        output: { content: 'ok' },
      },
    ])
  })

  it('patches the flushed assistant message when a later tool-run completes the committed tool', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'spawn_subagent',
        status: 'done',
        args: { agentName: 'explore', prompt: 'look around' },
        stepId: 'step-1',
      },
      flushTurn,
    )
    flushTurn()

    const staleMessage = acc.nextMessages[0]
    const staleTool = staleMessage?.parts.find(
      (part) => part.type === 'dynamic-tool' && part.toolCallId === 'tc-1',
    )
    expect(staleTool).toMatchObject({
      type: 'dynamic-tool',
      toolName: 'spawn_subagent',
      toolCallId: 'tc-1',
      state: 'output-available',
    })
    expect(staleTool).not.toMatchObject({
      output: { subagentId: 'sub-1', label: 'explore', status: 'done' },
    })

    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'spawn_subagent',
        status: 'done',
        result: { subagentId: 'sub-1', label: 'explore', status: 'done' },
        stepId: 'step-2',
      },
      flushTurn,
    )
    flushTurn()

    expect(acc.nextMessages).toHaveLength(1)
    const message = acc.nextMessages[0]
    expect(message?.role).toBe('assistant')
    const toolPart = message?.parts.find(
      (part) => part.type === 'dynamic-tool' && part.toolCallId === 'tc-1',
    )
    expect(toolPart).toEqual({
      type: 'dynamic-tool',
      toolName: 'spawn_subagent',
      toolCallId: 'tc-1',
      state: 'output-available',
      input: { agentName: 'explore', prompt: 'look around' },
      output: { subagentId: 'sub-1', label: 'explore', status: 'done' },
    })
  })

  it('flushes assistant message text from step text when turn.text is empty', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
        stepId: 'step-1',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'step-text',
        stepId: 'step-1',
        text: 'read the file',
      },
      flushTurn,
    )
    flushTurn()

    expect(acc.nextMessages[0]?.parts).toEqual([
      { type: 'text', text: 'read the file' },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { path: 'a.ts' },
        output: { content: 'ok' },
      },
    ])
  })

  it('projects multi-step text and tools in chronological order', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'grep',
        status: 'done',
        args: { pattern: 'TODO' },
        result: { matches: 1 },
        stepId: 'step-1',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'step-text',
        stepId: 'step-1',
        text: 'I will search.',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-2',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
        stepId: 'step-2',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'step-text',
        stepId: 'step-2',
        text: 'Opening the file.',
      },
      flushTurn,
    )
    flushTurn()

    expect(acc.nextMessages[0]?.parts).toEqual([
      { type: 'text', text: 'I will search.' },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'grep',
        toolCallId: 'tc-1',
        state: 'output-available',
        input: { pattern: 'TODO' },
        output: { matches: 1 },
      },
      { type: 'text', text: 'Opening the file.' },
      { type: 'step-start' },
      {
        type: 'dynamic-tool',
        toolName: 'read_file',
        toolCallId: 'tc-2',
        state: 'output-available',
        input: { path: 'a.ts' },
        output: { content: 'ok' },
      },
    ])
  })

  it('does not flip a committed done tool back to running', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
      },
      flushTurn,
    )
    flushTurn()
    const patched = hydrateTimelineBuilder.upsertCommittedTool(acc, {
      toolCallId: 'tc-1',
      name: 'read_file',
      status: 'running',
      args: { path: 'a.ts' },
    })
    expect(patched).toBe(true)
    const turn = acc.nextTimeline[0]
    expect(turn?.type).toBe('agent-turn')
    if (turn?.type !== 'agent-turn') {
      return
    }
    expect(turn.turn.steps[0]?.tools[0]).toMatchObject({
      toolCallId: 'tc-1',
      status: 'done',
      result: { content: 'ok' },
    })
  })

  it('treats a persisted running tool-run as an error', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-open',
        name: 'read_file',
        status: 'running',
        args: { path: 'a.ts' },
      },
      noopFlush,
    )
    expect(acc.pendingTurn?.steps[0]?.tools[0]).toMatchObject({
      toolCallId: 'tc-open',
      status: 'error',
      result: { error: 'Tool did not complete' },
    })
  })

  it('uses the legacy-step fallback when no current step exists', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-legacy',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
      },
      noopFlush,
    )
    expect(acc.currentStepId).toBe('legacy-step')
    expect(acc.pendingTurn?.id).toBe('tc-legacy')
    expect(acc.pendingTurn?.steps[0]?.id).toBe('legacy-step')
    expect(acc.pendingTurn?.steps[0]?.tools[0]?.toolCallId).toBe('tc-legacy')
  })
})

describe('hydrate-harness subagent-event', () => {
  it('shifts a matching pending steer when the nested steer lands', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
      },
      noopFlush,
    )
    const started = acc.nextTimeline[0]
    expect(started?.type).toBe('subagent')
    if (started?.type !== 'subagent') {
      return
    }
    acc.nextTimeline[0] = { ...started, pendingSteers: ['keep going'] }
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: { type: 'subagent-steer', message: 'keep going' },
      },
      noopFlush,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('running')
    expect(item.steers).toEqual([{ message: 'keep going', toolBoundary: 0 }])
    expect(item.pendingSteers).toEqual([])
  })

  it('stores nested compaction with a toolBoundary equal to the tool count', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
      },
      noopFlush,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: {
          type: 'tool-start',
          toolCallId: 't1',
          name: 'read_file',
          args: { path: 'a.ts' },
        },
      },
      noopFlush,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-event',
        subagentId: 'sub-1',
        event: { type: 'compaction', summary: 'Kept the file reads', focus: 'auth' },
      },
      noopFlush,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.compactions).toEqual([
      { summary: 'Kept the file reads', focus: 'auth', toolBoundary: 1 },
    ])
    expect(item.compacting).toBe(false)
  })
})

describe('hydrate-harness pending subagents', () => {
  it('merges pending subagents on flush and keeps later events on that item', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-parent',
        name: 'spawn_subagent',
        status: 'done',
        stepId: 'step-1',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
        prompt: 'look around',
      },
      flushTurn,
    )
    expect(acc.pendingSubagents).toHaveLength(1)
    expect(acc.nextTimeline).toHaveLength(0)
    flushTurn()
    expect(acc.pendingSubagents).toHaveLength(0)
    expect(acc.nextTimeline.map((item) => item.type)).toEqual(['agent-turn', 'subagent'])
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'pending-subagent',
        subagentId: 'sub-1',
        prompt: 'look around harder',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-result',
        subagentId: 'sub-1',
        summary: 'found things',
        outcome: 'completed',
      },
      flushTurn,
    )
    const item = acc.nextTimeline[1]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.prompt).toBe('look around harder')
    expect(item.status).toBe('done')
    expect(item.summary).toBe('found things')
  })
})

describe('hydrate-harness createdAt stamp', () => {
  it('stamps a tool-only turn from the first harness line', () => {
    const acc = emptyAcc()
    const first = '2026-01-01T00:00:00.000Z'
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        stepId: 'step-1',
      },
      noopFlush,
      first,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-2',
        name: 'read_file',
        status: 'done',
        args: { path: 'b.ts' },
        stepId: 'step-1',
      },
      noopFlush,
      '2026-01-01T00:00:02.000Z',
    )
    expect(acc.pendingTurn?.createdAt).toBe(first)
  })

  it('uses a dropped step-boundary line as the turn stamp', () => {
    const acc = emptyAcc()
    const first = '2026-01-01T00:00:00.000Z'
    applyHydrateHarnessEvent(
      acc,
      { type: 'step-boundary', stepId: 'step-1', action: 'start' },
      noopFlush,
      first,
    )
    expect(acc.pendingTurn).toBeNull()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
      },
      noopFlush,
      '2026-01-01T00:00:01.000Z',
    )
    expect(acc.pendingTurn?.createdAt).toBe(first)
  })

  it('does not replace the first-line stamp with a later assistant parts line', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const first = '2026-01-01T00:00:00.000Z'
    applyHydrateLine(
      acc,
      {
        id: 'line-1',
        role: 'assistant',
        parts: [],
        createdAt: first,
        harnessEvent: {
          type: 'tool-run',
          toolCallId: 'tc-1',
          name: 'read_file',
          status: 'done',
          args: { path: 'a.ts' },
          result: { content: 'ok' },
          stepId: 'step-1',
        },
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      {
        id: 'line-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }],
        createdAt: '2026-01-01T00:00:05.000Z',
      },
      flushTurn,
    )
    const item = acc.nextTimeline.find((entry) => entry.type === 'agent-turn')
    expect(item?.type).toBe('agent-turn')
    if (item?.type !== 'agent-turn') {
      return
    }
    expect(item.turn.createdAt).toBe(first)
    expect(acc.nextMessages[0]?.metadata).toEqual({ createdAt: first })
  })

  it('does not leak a flushed compaction stamp onto the next turn', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const first = '2026-01-01T00:00:00.000Z'
    const second = '2026-01-01T00:10:00.000Z'
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
        stepId: 'step-1',
      },
      flushTurn,
      first,
    )
    applyHydrateHarnessEvent(
      acc,
      { type: 'compaction', summary: 'Prior work' },
      flushTurn,
      '2026-01-01T00:05:00.000Z',
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-2',
        name: 'read_file',
        status: 'done',
        args: { path: 'b.ts' },
        stepId: 'step-2',
      },
      flushTurn,
      second,
    )
    const turns = acc.nextTimeline.filter((item) => item.type === 'agent-turn')
    expect(turns).toHaveLength(1)
    const flushed = turns[0]
    expect(flushed?.type).toBe('agent-turn')
    if (flushed?.type !== 'agent-turn') {
      return
    }
    expect(flushed.turn.createdAt).toBe(first)
    expect(acc.pendingTurn?.createdAt).toBe(second)
  })

  it('does not stamp a later tool-run from a prior subagent-start', () => {
    const acc = emptyAcc()
    const early = '2026-01-01T00:00:00.000Z'
    const later = '2026-01-01T00:00:10.000Z'
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        name: 'explore',
        blocking: false,
      },
      noopFlush,
      early,
    )
    expect(acc.pendingTurn).toBeNull()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
      },
      noopFlush,
      later,
    )
    expect(acc.pendingTurn?.createdAt).toBe(later)
  })

  it('does not invent a createdAt when none is provided', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-legacy',
        name: 'read_file',
        status: 'done',
        args: { path: 'a.ts' },
      },
      noopFlush,
    )
    expect(acc.pendingTurn?.createdAt).toBeUndefined()
  })
})

describe('hydrate-lines reasoning duration', () => {
  it('copies duration onto the step that receives reasoning text', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'think', duration: 4 },
          { type: 'text', text: 'hi' },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('agent-turn')
    if (item?.type !== 'agent-turn') {
      return
    }
    expect(item.turn.steps[0]?.reasoning).toBe('think')
    expect(item.turn.steps[0]?.reasoningSeconds).toBe(4)
  })

  it('does not set reasoningSeconds when duration is missing', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'think' }, { type: 'text', text: 'hi' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('agent-turn')
    if (item?.type !== 'agent-turn') {
      return
    }
    expect(item.turn.steps[0]?.reasoning).toBe('think')
    expect(item.turn.steps[0]?.reasoningSeconds).toBeUndefined()
  })

  it('attaches duration to the earliest step when tools already created steps', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-1',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
      },
      noopFlush,
      '2026-01-01T00:00:00.000Z',
    )
    applyHydrateLine(
      acc,
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'plan', duration: 6 }],
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      flushTurn,
    )
    const item = acc.nextTimeline.find((entry) => entry.type === 'agent-turn')
    expect(item?.type).toBe('agent-turn')
    if (item?.type !== 'agent-turn') {
      return
    }
    expect(item.turn.steps[0]?.reasoning).toBe('plan')
    expect(item.turn.steps[0]?.reasoningSeconds).toBe(6)
  })

  it('sums durations when multiple reasoning parts are present', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'asst-1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'a', duration: 2 },
          { type: 'reasoning', text: 'b', duration: 3 },
        ],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('agent-turn')
    if (item?.type !== 'agent-turn') {
      return
    }
    expect(item.turn.steps[0]?.reasoning).toBe('ab')
    expect(item.turn.steps[0]?.reasoningSeconds).toBe(5)
  })
})
