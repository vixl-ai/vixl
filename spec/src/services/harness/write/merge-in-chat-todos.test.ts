import { describe, expect, it } from 'vitest'
import mergeInChatTodos from '@/services/harness/write/merge-in-chat-todos'
import type { PlanTodoItem } from '@/types/plans/plan-document'

const existing: PlanTodoItem[] = [
  { id: 'review', content: 'Review harness wiring', status: 'completed' },
  { id: 'tests', content: 'Cover update_todos', status: 'pending' },
]

describe('mergeInChatTodos', () => {
  it('merges a status-only patch and preserves other fields', () => {
    expect(
      mergeInChatTodos(existing, [{ id: 'tests', status: 'in_progress' }]),
    ).toEqual([
      { id: 'review', content: 'Review harness wiring', status: 'completed' },
      { id: 'tests', content: 'Cover update_todos', status: 'in_progress' },
    ])
  })

  it('appends an unknown id when full fields are provided', () => {
    expect(
      mergeInChatTodos(existing, [
        { id: 'ship', content: 'Ship the merge', status: 'pending' },
      ]),
    ).toEqual([
      ...existing,
      { id: 'ship', content: 'Ship the merge', status: 'pending' },
    ])
  })

  it('errors clearly when an unknown id is missing content', () => {
    expect(() => mergeInChatTodos(existing, [{ id: 'ship', status: 'pending' }])).toThrow(
      'Cannot append todo ship: content is required for new ids',
    )
  })

  it('replaces fields when a full object is sent for an existing id', () => {
    expect(
      mergeInChatTodos(existing, [
        { id: 'review', content: 'Review harness wiring', status: 'completed' },
        { id: 'tests', content: 'Cover update_todos', status: 'completed' },
      ]),
    ).toEqual([
      { id: 'review', content: 'Review harness wiring', status: 'completed' },
      { id: 'tests', content: 'Cover update_todos', status: 'completed' },
    ])
  })
})
