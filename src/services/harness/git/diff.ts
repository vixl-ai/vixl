import { tool } from 'ai'
import { z } from 'zod'
import { gitDiff as gitDiffCommand } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitDiff = (ctx: HarnessToolContext) =>
  tool({
    description: 'Git diff',
    inputSchema: z.object({ path: z.string().optional() }),
    execute: async ({ path }) => gitDiffCommand({ projectRoot: ctx.projectRoot, path }),
  })

export default gitDiff
