import { tool } from 'ai'
import { z } from 'zod'
import deliverSteer from '@/services/harness/subagent/deliver-steer'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const steerSubagent = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Send a follow-up to a spawned subagent. Delivered at the next step if running; resumes a completed or failed subagent in the background and the harness wakes you with the result.',
    inputSchema: z.object({
      subagentId: z.string().describe('Id returned by spawn_subagent'),
      agentName: z
        .string()
        .describe('Name returned by spawn_subagent for this subagentId'),
      message: z.string().describe('Follow-up instructions for the subagent'),
    }),
    execute: async ({
      subagentId,
      agentName,
      message,
    }): Promise<{
      subagentId: string
      name: string
      status: 'running'
      note: string
    }> => deliverSteer(ctx, subagentId, message, agentName),
  })

export default steerSubagent
