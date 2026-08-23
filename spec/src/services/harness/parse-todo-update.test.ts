import { describe, expect, it } from 'vitest'
import parseTodoUpdate from '@/services/harness/parse-todo-update'
import type { TodoItem } from '@/types/harness/harness-event'

const sampleTodos: TodoItem[] = [
  { id: 'a', content: 'First', status: 'completed' },
  { id: 'b', content: 'Second', status: 'pending' },
]

describe('parseTodoUpdate', () => {
  it('accepts update_todos results and returns the todos array', () => {
    expect(parseTodoUpdate('update_todos', { todos: sampleTodos })).toEqual(sampleTodos)
  })

  it('accepts write_todos results for historical tool names', () => {
    expect(parseTodoUpdate('write_todos', { todos: sampleTodos })).toEqual(sampleTodos)
  })

  it('accepts create_plan and update_plan_todo results with the same shape', () => {
    expect(parseTodoUpdate('create_plan', { todos: sampleTodos, path: 'x' })).toEqual(
      sampleTodos,
    )
    expect(
      parseTodoUpdate('update_plan_todo', { planPath: 'x', todos: sampleTodos }),
    ).toEqual(sampleTodos)
  })

  it('returns null for unrelated tools or missing todos', () => {
    expect(parseTodoUpdate('read_file', { todos: sampleTodos })).toBeNull()
    expect(parseTodoUpdate('update_todos', { ok: true })).toBeNull()
    expect(parseTodoUpdate('update_todos', { todos: 'nope' })).toBeNull()
    expect(parseTodoUpdate('update_todos', null)).toBeNull()
    expect(parseTodoUpdate('write_todos', { ok: true })).toBeNull()
    expect(parseTodoUpdate('write_todos', { todos: 'nope' })).toBeNull()
    expect(parseTodoUpdate('write_todos', null)).toBeNull()
  })
})
