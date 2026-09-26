import { afterEach, describe, expect, it, vi } from 'vitest'
import { shallowMount, type VueWrapper } from '@vue/test-utils'

vi.hoisted(() => {
  Object.defineProperty(document, 'queryCommandSupported', {
    configurable: true,
    value: () => false,
  })
})

import ChatAgentTurn from '@/components/chat/ChatAgentTurn.vue'
import ChatTurnFilesChanged from '@/components/chat/ChatTurnFilesChanged.vue'
import Reasoning from '@/components/ai-elements/reasoning/Reasoning.vue'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import type { FileDiff, FileDiffOperation } from '@/types/harness/file-diff'
import type { ToolRun } from '@/types/harness/tool-run'
import type { ChatStatus } from 'ai'

const diff = (
  path: string,
  operation: FileDiffOperation,
  additions: number,
  deletions: number,
): FileDiff => ({
  path,
  operation,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        ...Array.from({ length: deletions }, () => ({
          kind: 'remove' as const,
          content: 'old',
        })),
        ...Array.from({ length: additions }, () => ({
          kind: 'add' as const,
          content: 'new',
        })),
      ],
    },
  ],
})

const run = (
  partial: Partial<ToolRun> & Pick<ToolRun, 'toolCallId' | 'status'>,
): ToolRun => ({
  name: 'edit_file',
  ...partial,
})

const makeTurn = (id: string, tools: ToolRun[]): AgentTurn => ({
  id,
  text: '',
  steps: [
    {
      id: `${id}-step`,
      text: '',
      reasoning: '',
      tools,
    },
  ],
})

const turnWithATs = (): AgentTurn =>
  makeTurn('t1', [
    run({
      toolCallId: 't1-tool',
      status: 'done',
      diffs: [diff('a.ts', 'update', 2, 1)],
    }),
  ])

const cumulativeChanges: AggregatedTurnFileChange[] = [
  { path: 'a.ts', operation: 'update', additions: 2, deletions: 1 },
  { path: 'b.ts', operation: 'create', additions: 3, deletions: 0 },
]

const restoreScope: AggregatedTurnFileChange[] = [
  { path: 'a.ts', operation: 'update', additions: 2, deletions: 1 },
  { path: 'retry.ts', operation: 'create', additions: 1, deletions: 0 },
]

const filesChangedStub = {
  name: 'ChatTurnFilesChanged',
  props: ['changes', 'restoreChanges', 'restoreEnabled', 'restoreDiscardsLatestMessage'],
  template: '<div data-testid="files-changed" />',
}

let wrapper: VueWrapper | null = null

const mountTurn = (
  props: {
    turn?: AgentTurn
    status?: ChatStatus
    chatFileChanges?: AggregatedTurnFileChange[] | null
    restoreChanges?: AggregatedTurnFileChange[]
    restoreDiscardsLatestMessage?: boolean
  } = {},
): VueWrapper => {
  wrapper = shallowMount(ChatAgentTurn, {
    props: {
      turn: props.turn ?? turnWithATs(),
      status: props.status,
      chatFileChanges: props.chatFileChanges,
      restoreChanges: props.restoreChanges,
      restoreDiscardsLatestMessage: props.restoreDiscardsLatestMessage,
    },
    global: {
      renderStubDefaultSlot: true,
      stubs: {
        ChatTurnFilesChanged: filesChangedStub,
        ChatAgentTurnUsage: true,
      },
    },
  })
  return wrapper
}

const filesChanged = (mounted: VueWrapper) => {
  const byRef = mounted.findAllComponents(ChatTurnFilesChanged)
  if (byRef.length > 0) {
    return byRef
  }
  return mounted.findAllComponents({ name: 'ChatTurnFilesChanged' })
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChatAgentTurn files changed', () => {
  it('renders the files-changed block when chatFileChanges is non-empty and status is not streaming', () => {
    const mounted = mountTurn({
      status: 'ready',
      chatFileChanges: cumulativeChanges,
    })

    expect(filesChanged(mounted)).toHaveLength(1)
  })

  it('does not render the block when chatFileChanges is null or empty', () => {
    const withNull = mountTurn({
      status: 'ready',
      chatFileChanges: null,
    })
    expect(filesChanged(withNull)).toHaveLength(0)
    withNull.unmount()

    const withEmpty = mountTurn({
      status: 'ready',
      chatFileChanges: [],
    })
    expect(filesChanged(withEmpty)).toHaveLength(0)
  })

  it('does not render the block while status is streaming even with non-empty chatFileChanges', () => {
    const mounted = mountTurn({
      status: 'streaming',
      chatFileChanges: cumulativeChanges,
    })

    expect(filesChanged(mounted)).toHaveLength(0)
  })

  it('passes restoreChanges from the restoreChanges prop and changes from chatFileChanges', () => {
    const mounted = mountTurn({
      status: 'ready',
      chatFileChanges: cumulativeChanges,
      restoreChanges: restoreScope,
    })

    const block = filesChanged(mounted)[0]
    expect(block).toBeDefined()
    expect(block?.props('changes')).toEqual(cumulativeChanges)
    expect(block?.props('restoreChanges')).toEqual(restoreScope)
  })

  it('passes restoreDiscardsLatestMessage through to ChatTurnFilesChanged', () => {
    const mounted = mountTurn({
      status: 'ready',
      chatFileChanges: cumulativeChanges,
      restoreDiscardsLatestMessage: true,
    })

    const block = filesChanged(mounted)[0]
    expect(block).toBeDefined()
    expect(block?.props('restoreDiscardsLatestMessage')).toBe(true)
  })
})

const reasoningTurn = (reasoningSeconds?: number): AgentTurn => ({
  id: 't1',
  text: '',
  steps: [
    {
      id: 't1-step',
      text: '',
      reasoning: 'the plan',
      ...(reasoningSeconds === undefined ? {} : { reasoningSeconds }),
      tools: [],
    },
  ],
})

const reasoningBlock = (mounted: VueWrapper) => {
  const byRef = mounted.findComponent(Reasoning)
  if (byRef.exists()) {
    return byRef
  }
  return mounted.findComponent({ name: 'AiElementsReasoningReasoning' })
}

describe('ChatAgentTurn reasoning duration', () => {
  it('passes step.reasoningSeconds to the reasoning block', () => {
    const mounted = mountTurn({
      status: 'ready',
      turn: reasoningTurn(4),
    })
    expect(reasoningBlock(mounted).props('duration')).toBe(4)
  })

  it('leaves duration undefined when the step has no reasoningSeconds', () => {
    const mounted = mountTurn({
      status: 'ready',
      turn: reasoningTurn(),
    })
    expect(reasoningBlock(mounted).props('duration')).toBeUndefined()
  })
})
