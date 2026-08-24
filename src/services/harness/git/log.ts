import { tool } from 'ai'
import { z } from 'zod'
import { gitLog as gitLogCommand } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitLog = (ctx: HarnessToolContext) =>
  tool({
    description: 'Git log',
    inputSchema: z.object({ limit: z.number().optional() }),
    execute: async ({ limit }) => gitLogCommand(ctx.projectRoot, limit),
  })

export default gitLog
