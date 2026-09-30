import { tool } from 'ai'
import { z } from 'zod'
import { planTodoItemSchema } from '@/schemas/plan-document'

const updateTodos = () =>
  tool({
    description:
      'Replace the in-chat todo list shown in Tasks. Each todo is one short verb-first actionable line.',
    inputSchema: z.object({
      todos: z.array(planTodoItemSchema).describe('Full todo list'),
    }),
    execute: async ({ todos }) => {
      const normalized = z.array(planTodoItemSchema).parse(todos)
      return { todos: normalized }
    },
  })

export default updateTodos
