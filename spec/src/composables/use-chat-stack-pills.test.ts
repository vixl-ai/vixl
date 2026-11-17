import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import useChatStackPills from '@/composables/use-chat-stack-pills'
import type { ChatStackId } from '@/types/chat/chat-stack-id'

const createCounts = () => ({
  subagents: ref(0),
  approvals: ref(0),
  terminals: ref(0),
  queue: ref(0),
  todos: ref(0),
  resetKey: ref('chat-1'),
})

const createPills = (counts = createCounts()) => ({
  counts,
  pills: useChatStackPills(counts),
})

const settle = async (): Promise<void> => {
  await nextTick()
}

describe('useChatStackPills', () => {
  it('keeps fixed pill order when counts hydrate late', async () => {
    const { counts, pills } = createPills()

    counts.todos.value = 3
    await settle()
    counts.terminals.value = 1
    await settle()

    expect(pills.visiblePills.value).toEqual<ChatStackId[]>(['terminals', 'todos'])
  })

  it('shows the same order for two visits that hydrate in different order', async () => {
    const first = createPills()
    const second = createPills()

    first.counts.approvals.value = 1
    await settle()
    first.counts.subagents.value = 2
    first.counts.queue.value = 1
    await settle()

    second.counts.queue.value = 1
    second.counts.subagents.value = 2
    await settle()
    second.counts.approvals.value = 1
    await settle()

    expect(second.pills.visiblePills.value).toEqual(first.pills.visiblePills.value)
    expect(first.pills.visiblePills.value).toEqual<ChatStackId[]>([
      'subagents',
      'approvals',
      'queue',
    ])
  })

  it('re-enters a returning pill at its own slot', async () => {
    const { counts, pills } = createPills()

    counts.terminals.value = 1
    counts.todos.value = 2
    await settle()

    counts.terminals.value = 0
    await settle()
    expect(pills.visiblePills.value).toEqual<ChatStackId[]>(['todos'])

    counts.terminals.value = 2
    await settle()
    expect(pills.visiblePills.value).toEqual<ChatStackId[]>(['terminals', 'todos'])
  })

  it('closes the open stack when its count drops to zero', async () => {
    const { counts, pills } = createPills()

    counts.terminals.value = 1
    await settle()
    pills.toggleStack('terminals')
    expect(pills.openStack.value).toBe('terminals')

    counts.terminals.value = 0
    await settle()
    expect(pills.openStack.value).toBeNull()
  })

  it('keeps another stack open when an unrelated count drops to zero', async () => {
    const { counts, pills } = createPills()

    counts.todos.value = 2
    counts.terminals.value = 1
    await settle()
    pills.toggleStack('todos')

    counts.terminals.value = 0
    await settle()
    expect(pills.openStack.value).toBe('todos')
  })

  it('opens the approvals stack when pending approvals increase', async () => {
    const { counts, pills } = createPills()

    counts.approvals.value = 1
    await settle()

    expect(pills.openStack.value).toBe('approvals')
  })

  it('resets the open stack when the thread key changes', async () => {
    const { counts, pills } = createPills()

    counts.todos.value = 2
    await settle()
    pills.toggleStack('todos')

    counts.resetKey.value = 'chat-2'
    await settle()
    expect(pills.openStack.value).toBeNull()

    counts.approvals.value = 1
    await settle()
    counts.resetKey.value = 'chat-3'
    await settle()
    expect(pills.openStack.value).toBe('approvals')
  })
})
