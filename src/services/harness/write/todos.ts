import { tool } from 'ai'
import { z } from 'zod'
import { planTodoItemSchema } from '@/schemas/plan-document'
import withToolExamples from '@/services/harness/with-tool-examples'

const updateTodos = () =>
  tool({
    description: withToolExamples(
      'Create, update, complete, cancel, or remove in-chat todos by sending the full list. Full-array replace shown in Tasks. Does not require a plan and does not write a plan file.',
      [
        {
          todos: [
            {
              id: 'review',
              content: 'Review harness tool wiring',
              status: 'completed',
            },
            {
              id: 'implement',
              content: 'Add update_todos tool',
              status: 'in_progress',
            },
            {
              id: 'tests',
              content: 'Cover update_todos in tests',
              status: 'pending',
            },
          ],
        },
      ],
    ),
    inputSchema: z.object({
      todos: z.array(planTodoItemSchema).describe('Full todo list to show in chat Tasks'),
    }),
    execute: async ({ todos }) => {
      const normalized = z.array(planTodoItemSchema).parse(todos)
      return { todos: normalized }
    },
  })

export default updateTodos
