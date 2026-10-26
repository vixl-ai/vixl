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

  it('keeps a persisted running tool as did-not-complete after flush', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-open',
        name: 'read_file',
        status: 'running',
        args: { path: 'a.ts' },
      },
      flushTurn,
    )
    flushTurn()
    const turn = acc.nextTimeline[0]
    expect(turn?.type).toBe('agent-turn')
    if (turn?.type !== 'agent-turn') {
      return
    }
    expect(turn.turn.steps[0]?.tools[0]).toMatchObject({
      toolCallId: 'tc-open',
      status: 'error',
      result: { error: 'Tool did not complete' },
    })
    expect(turn.turn.steps[0]?.tools[0]?.result).not.toEqual({
      error: 'Tool call was cut off before it finished',
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

const turnById = (acc: HydrateAccumulator, turnId: string) => {
  const item = acc.nextTimeline.find(
    (entry) => entry.type === 'agent-turn' && entry.turn.id === turnId,
  )
  return item?.type === 'agent-turn' ? item.turn : null
}

describe('hydrate-harness turn-ended', () => {
  it('attaches stop to the open pending turn and does not flush it', () => {
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
      },
      flushTurn,
    )
    expect(acc.pendingTurn?.id).toBe('tc-1')

    const consumed = applyHydrateLine(
      acc,
      {
        id: 'assistant-1-ended',
        role: 'assistant',
        parts: [],
        createdAt: '2026-01-01T00:00:02.000Z',
        harnessEvent: {
          type: 'turn-ended',
          turnId: 'assistant-1',
          stop: { reason: 'completed', finish: 'stop' },
        },
      },
      flushTurn,
    )
    expect(consumed).toBeUndefined()
    expect(acc.pendingTurn?.id).toBe('tc-1')
    expect(acc.pendingTurn?.stop).toEqual({ reason: 'completed', finish: 'stop' })
    expect(acc.nextTimeline).toHaveLength(0)

    applyHydrateLine(
      acc,
      {
        id: 'assistant-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'done' }],
        createdAt: '2026-01-01T00:00:03.000Z',
      },
      flushTurn,
    )
    expect(turnById(acc, 'assistant-1')?.stop).toEqual({
      reason: 'completed',
      finish: 'stop',
    })
    expect(JSON.stringify(acc.nextMessages)).not.toContain('"reason"')
  })

  it('patches a flushed turn by id when a compaction item is last', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'turn-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'first' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      {
        id: 'turn-2',
        role: 'assistant',
        parts: [{ type: 'text', text: 'second' }],
        createdAt: '2026-01-01T00:00:02.000Z',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      { type: 'compaction', summary: 'rolled up', focus: null },
      flushTurn,
    )
    expect(acc.pendingTurn).toBeNull()
    expect(acc.nextTimeline.at(-1)?.type).toBe('compaction')
    const messageBefore = acc.nextMessages[0]

    const consumed = applyHydrateHarnessEvent(
      acc,
      {
        type: 'turn-ended',
        turnId: 'turn-1',
        stop: { reason: 'output-limit', finish: 'length', detail: 'cut off' },
      },
      flushTurn,
    )

    expect(consumed).toBe(true)
    expect(turnById(acc, 'turn-1')?.stop).toEqual({
      reason: 'output-limit',
      finish: 'length',
      detail: 'cut off',
    })
    expect(turnById(acc, 'turn-2')?.stop).toBeUndefined()
    expect(acc.nextTimeline.at(-1)).toEqual({
      type: 'compaction',
      summary: 'rolled up',
      focus: null,
    })
    expect(acc.nextMessages[0]).toBe(messageBefore)
  })

  it('keeps an unmatched failure stop off earlier turns and drops a malformed stop', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'turn-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'kept' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )

    expect(
      applyHydrateHarnessEvent(
        acc,
        {
          type: 'turn-ended',
          turnId: 'missing',
          stop: { reason: 'error', detail: 'gone' },
        },
        flushTurn,
      ),
    ).toBe(true)
    expect(turnById(acc, 'turn-1')?.stop).toBeUndefined()
    expect(turnById(acc, 'missing')).toEqual({
      id: 'missing',
      steps: [],
      text: '',
      stop: { reason: 'error', detail: 'gone' },
    })
    expect(JSON.stringify(acc.nextMessages)).not.toContain('"reason"')

    applyHydrateHarnessEvent(
      acc,
      {
        type: 'tool-run',
        toolCallId: 'tc-open',
        name: 'read_file',
        status: 'done',
        stepId: 'step-open',
      },
      flushTurn,
    )
    expect(
      applyHydrateLine(
        acc,
        {
          id: 'bad-ended',
          role: 'assistant',
          parts: [],
          createdAt: '2026-01-01T00:00:04.000Z',
          harnessEvent: {
            type: 'turn-ended',
            stop: { reason: 'not-a-reason' },
          },
        },
        flushTurn,
      ),
    ).toBeUndefined()
    expect(acc.pendingTurn?.id).toBe('tc-open')
    expect(acc.pendingTurn?.stop).toBeUndefined()
  })

  it('puts compaction on the closed turn and completed on the continuation', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const line = (
      id: string,
      createdAt: string,
      harnessEvent: Record<string, unknown>,
    ) => ({
      id,
      role: 'assistant' as const,
      parts: [] as Array<Record<string, unknown>>,
      createdAt,
      harnessEvent,
    })

    applyHydrateLine(
      acc,
      line('tc-pre', '2026-01-01T00:00:01.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-pre',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('step-1-text', '2026-01-01T00:00:02.000Z', {
        type: 'step-text',
        stepId: 'step-1',
        text: 'before',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-1', '2026-01-01T00:00:03.000Z', {
        type: 'compaction',
        summary: 'rolled up',
        focus: 'parent',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended-compaction', '2026-01-01T00:00:04.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'compaction' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('tc-post', '2026-01-01T00:00:05.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-post',
        name: 'edit_file',
        status: 'done',
        stepId: 'step-2',
        args: { path: 'b.ts' },
        result: { content: 'later' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('step-2-text', '2026-01-01T00:00:06.000Z', {
        type: 'step-text',
        stepId: 'step-2',
        text: 'after',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      {
        id: 't1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'after' }],
        createdAt: '2026-01-01T00:00:07.000Z',
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended', '2026-01-01T00:00:08.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'completed', finish: 'stop' },
      }),
      flushTurn,
    )

    expect(acc.nextTimeline.map((item) => item.type)).toEqual([
      'agent-turn',
      'compaction',
      'agent-turn',
    ])
    const turns = acc.nextTimeline.flatMap((item) =>
      item.type === 'agent-turn' ? [item.turn] : [],
    )
    expect(turns[0]?.id).toBe('tc-pre')
    expect(turns[0]?.stop).toEqual({ reason: 'compaction' })
    expect(turns[1]?.id).toBe('t1')
    expect(turns[1]?.stop).toEqual({ reason: 'completed', finish: 'stop' })
  })

  it('keeps a failure stop when that turn never wrote scaffolding', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'hello' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      {
        id: 'turn-timeout-ended',
        role: 'assistant',
        parts: [],
        createdAt: '2026-01-01T00:00:01.000Z',
        harnessEvent: {
          type: 'turn-ended',
          turnId: 'turn-timeout',
          stop: {
            reason: 'timeout',
            detail: 'The model took too long to respond.',
          },
        },
      },
      flushTurn,
    )
    flushTurn()

    expect(acc.nextTimeline.map((item) => item.type)).toEqual(['user', 'agent-turn'])
    expect(turnById(acc, 'turn-timeout')).toEqual({
      id: 'turn-timeout',
      steps: [],
      text: '',
      stop: {
        reason: 'timeout',
        detail: 'The model took too long to respond.',
      },
    })
    expect(JSON.stringify(acc.nextMessages)).not.toContain('timeout')

    applyHydrateHarnessEvent(
      acc,
      {
        type: 'turn-ended',
        turnId: 'turn-timeout',
        stop: { reason: 'error', detail: 'late' },
      },
      flushTurn,
    )
    expect(turnById(acc, 'turn-timeout')?.stop).toEqual({
      reason: 'timeout',
      detail: 'The model took too long to respond.',
    })
  })

  it('attaches an unmatched stop to the tool-id turn compaction flushed', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const line = (
      id: string,
      createdAt: string,
      harnessEvent: Record<string, unknown>,
    ) => ({
      id,
      role: 'assistant' as const,
      parts: [] as Array<Record<string, unknown>>,
      createdAt,
      harnessEvent,
    })

    applyHydrateLine(
      acc,
      {
        id: 'turn-old',
        role: 'assistant',
        parts: [{ type: 'text', text: 'kept' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('tc-pre', '2026-01-01T00:00:01.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-pre',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
        args: { path: 'a.ts' },
        result: { content: 'ok' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('step-1-text', '2026-01-01T00:00:02.000Z', {
        type: 'step-text',
        stepId: 'step-1',
        text: 'before',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-1', '2026-01-01T00:00:03.000Z', {
        type: 'compaction',
        summary: 'rolled up',
        focus: 'parent',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('live-turn-ended', '2026-01-01T00:00:04.000Z', {
        type: 'turn-ended',
        turnId: 'live-turn',
        stop: {
          reason: 'timeout',
          detail: 'The model took too long to respond.',
        },
      }),
      flushTurn,
    )

    expect(acc.nextTimeline.map((item) => item.type)).toEqual([
      'agent-turn',
      'agent-turn',
      'compaction',
    ])
    expect(turnById(acc, 'turn-old')?.stop).toBeUndefined()
    expect(turnById(acc, 'tc-pre')?.stop).toEqual({
      reason: 'timeout',
      detail: 'The model took too long to respond.',
    })
    expect(turnById(acc, 'live-turn')).toBeNull()
  })

  it('keeps a post-compaction failure when the closed turn already has a stop', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const line = (
      id: string,
      createdAt: string,
      harnessEvent: Record<string, unknown>,
    ) => ({
      id,
      role: 'assistant' as const,
      parts: [] as Array<Record<string, unknown>>,
      createdAt,
      harnessEvent,
    })

    applyHydrateLine(
      acc,
      line('tc-pre', '2026-01-01T00:00:01.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-pre',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-1', '2026-01-01T00:00:02.000Z', {
        type: 'compaction',
        summary: 'rolled up',
        focus: null,
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended-compaction', '2026-01-01T00:00:03.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'compaction' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended-error', '2026-01-01T00:00:04.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'error', detail: 'provider exploded' },
      }),
      flushTurn,
    )

    expect(acc.nextTimeline.map((item) => item.type)).toEqual([
      'agent-turn',
      'compaction',
      'agent-turn',
    ])
    expect(turnById(acc, 'tc-pre')?.stop).toEqual({ reason: 'compaction' })
    expect(turnById(acc, 't1')?.stop).toEqual({
      reason: 'error',
      detail: 'provider exploded',
    })
    expect(turnById(acc, 't1')?.steps).toEqual([])
    expect(turnById(acc, 't1')?.text).toBe('')
  })

  it('does not stamp an assistant-id turn next to compaction for an unmatched stop', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'turn-1',
        role: 'assistant',
        parts: [{ type: 'text', text: 'kept' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      { type: 'compaction', summary: 'rolled up', focus: null },
      flushTurn,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'turn-ended',
        turnId: 'missing',
        stop: { reason: 'error', detail: 'provider exploded' },
      },
      flushTurn,
    )

    expect(turnById(acc, 'turn-1')?.stop).toBeUndefined()
    expect(turnById(acc, 'missing')?.stop).toEqual({
      reason: 'error',
      detail: 'provider exploded',
    })
  })

  it('attaches an unmatched stop to a continuation flushed under its tool id', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const line = (
      id: string,
      createdAt: string,
      harnessEvent: Record<string, unknown>,
    ) => ({
      id,
      role: 'assistant' as const,
      parts: [] as Array<Record<string, unknown>>,
      createdAt,
      harnessEvent,
    })

    applyHydrateLine(
      acc,
      line('tc-pre', '2026-01-01T00:00:01.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-pre',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-1', '2026-01-01T00:00:02.000Z', {
        type: 'compaction',
        summary: 'rolled up',
        focus: 'parent',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended-compaction', '2026-01-01T00:00:03.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'compaction' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('tc-post', '2026-01-01T00:00:04.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-post',
        name: 'edit_file',
        status: 'done',
        stepId: 'step-2',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-2', '2026-01-01T00:00:05.000Z', {
        type: 'compaction',
        summary: 'continued',
        focus: null,
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('live-continuation-ended', '2026-01-01T00:00:06.000Z', {
        type: 'turn-ended',
        turnId: 'live-continuation',
        stop: { reason: 'error', detail: 'provider exploded' },
      }),
      flushTurn,
    )

    expect(acc.nextTimeline.map((item) => item.type)).toEqual([
      'agent-turn',
      'compaction',
      'agent-turn',
      'compaction',
    ])
    expect(turnById(acc, 'tc-pre')?.stop).toEqual({ reason: 'compaction' })
    expect(turnById(acc, 'tc-post')?.stop).toEqual({
      reason: 'error',
      detail: 'provider exploded',
    })
    expect(turnById(acc, 'live-continuation')).toBeNull()
  })

  it('does not stamp an earlier turn when the stop follows a later user message', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    const line = (
      id: string,
      createdAt: string,
      harnessEvent: Record<string, unknown>,
    ) => ({
      id,
      role: 'assistant' as const,
      parts: [] as Array<Record<string, unknown>>,
      createdAt,
      harnessEvent,
    })

    applyHydrateLine(
      acc,
      line('tc-pre', '2026-01-01T00:00:01.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-pre',
        name: 'read_file',
        status: 'done',
        stepId: 'step-1',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('compact-1', '2026-01-01T00:00:02.000Z', {
        type: 'compaction',
        summary: 'rolled up',
        focus: null,
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('t1-ended-compaction', '2026-01-01T00:00:03.000Z', {
        type: 'turn-ended',
        turnId: 't1',
        stop: { reason: 'compaction' },
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('tc-post', '2026-01-01T00:00:04.000Z', {
        type: 'tool-run',
        toolCallId: 'tc-post',
        name: 'edit_file',
        status: 'done',
        stepId: 'step-2',
      }),
      flushTurn,
    )
    applyHydrateLine(
      acc,
      {
        id: 'user-2',
        role: 'user',
        parts: [{ type: 'text', text: 'next' }],
        createdAt: '2026-01-01T00:00:05.000Z',
      },
      flushTurn,
    )
    applyHydrateLine(
      acc,
      line('live-continuation-ended', '2026-01-01T00:00:06.000Z', {
        type: 'turn-ended',
        turnId: 'live-continuation',
        stop: { reason: 'user-stop' },
      }),
      flushTurn,
    )

    expect(turnById(acc, 'tc-pre')?.stop).toEqual({ reason: 'compaction' })
    expect(turnById(acc, 'tc-post')?.stop).toBeUndefined()
    expect(turnById(acc, 'live-continuation')?.stop).toEqual({ reason: 'user-stop' })
  })
})

describe('hydrate-harness subagent-result stop', () => {
  it('carries stop onto the subagent and keeps it when a later result omits stop', () => {
    const acc = emptyAcc()
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-start',
        subagentId: 'sub-1',
        toolCallId: 'call-1',
        name: 'explore',
        blocking: true,
      },
      noopFlush,
    )
    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-result',
        subagentId: 'sub-1',
        summary: 'found things',
        blocking: true,
        outcome: 'completed',
        stop: { reason: 'completed', finish: 'stop', detail: 'ok' },
      },
      noopFlush,
    )
    const item = acc.nextTimeline[0]
    expect(item?.type).toBe('subagent')
    if (item?.type !== 'subagent') {
      return
    }
    expect(item.status).toBe('done')
    expect(item.stop).toEqual({ reason: 'completed', finish: 'stop', detail: 'ok' })

    applyHydrateHarnessEvent(
      acc,
      {
        type: 'subagent-result',
        subagentId: 'sub-1',
        summary: 'Stopped',
        blocking: true,
        outcome: 'aborted',
      },
      noopFlush,
    )
    const again = acc.nextTimeline[0]
    expect(again?.type).toBe('subagent')
    if (again?.type !== 'subagent') {
      return
    }
    expect(again.status).toBe('stopped')
    expect(again.summary).toBe('Stopped')
    expect(again.stop).toEqual({ reason: 'completed', finish: 'stop', detail: 'ok' })
  })
})

const harnessLine = (id: string, harnessEvent: Record<string, unknown>) => ({
  id,
  role: 'assistant' as const,
  parts: [] as Array<Record<string, unknown>>,
  createdAt: '2026-01-01T00:00:04.000Z',
  harnessEvent,
})

describe('hydrate background-wake', () => {
  it('puts a background-wake on messages as a hidden user wake', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      harnessLine('background-wake:chat:tool', {
        type: 'background-wake',
        content: 'wake body',
        toolCallIds: ['tool'],
        resultKeys: ['tool'],
      }),
      flushTurn,
    )

    expect(acc.nextTimeline.some((item) => item.type === 'user')).toBe(false)
    expect(acc.nextMessages).toHaveLength(1)
    expect(acc.nextMessages[0]).toEqual({
      id: 'background-wake:chat:tool',
      role: 'user',
      parts: [{ type: 'text', text: 'wake body' }],
      metadata: {
        createdAt: '2026-01-01T00:00:04.000Z',
        harnessWake: true,
      },
    })
  })

  it('still puts a normal user line on the timeline', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'user-1',
        role: 'user',
        parts: [{ type: 'text', text: 'please continue' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      flushTurn,
    )

    expect(acc.nextTimeline).toEqual([
      {
        type: 'user',
        message: {
          id: 'user-1',
          role: 'user',
          parts: [{ type: 'text', text: 'please continue' }],
          metadata: { createdAt: '2026-01-01T00:00:00.000Z' },
        },
      },
    ])
    expect(acc.nextMessages).toHaveLength(1)
    expect(acc.nextMessages[0]?.id).toBe('user-1')
    expect(acc.nextMessages[0]?.metadata).toEqual({
      createdAt: '2026-01-01T00:00:00.000Z',
    })
  })

  it('still puts a compaction harness line on the timeline', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      harnessLine('compact-1', {
        type: 'compaction',
        summary: 'Prior work',
        focus: 'parent',
      }),
      flushTurn,
    )

    expect(acc.nextTimeline).toEqual([
      { type: 'compaction', summary: 'Prior work', focus: 'parent' },
    ])
    expect(acc.nextMessages).toEqual([])
  })

  it('flushes a pending assistant turn before inserting the wake on messages', () => {
    const acc = emptyAcc()
    const flushTurn = createFlushTurn(acc)
    applyHydrateLine(
      acc,
      {
        id: 'tc-1',
        role: 'assistant',
        parts: [],
        createdAt: '2026-01-01T00:00:01.000Z',
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
    expect(acc.pendingTurn).not.toBeNull()
    applyHydrateLine(
      acc,
      harnessLine('background-wake:chat:tool', {
        type: 'background-wake',
        content: 'wake body',
        toolCallIds: ['tool'],
        resultKeys: ['tool'],
      }),
      flushTurn,
    )

    expect(acc.pendingTurn).toBeNull()
    expect(acc.nextTimeline.map((item) => item.type)).toEqual(['agent-turn'])
    expect(acc.nextMessages.map((message) => message.role)).toEqual([
      'assistant',
      'user',
    ])
    expect(acc.nextMessages[1]?.metadata).toEqual({
      createdAt: '2026-01-01T00:00:04.000Z',
      harnessWake: true,
    })
  })
})
