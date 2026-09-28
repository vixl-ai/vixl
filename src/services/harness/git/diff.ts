import { tool } from 'ai'
import { z } from 'zod'
import { gitDiff as gitDiffCommand } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gitDiff = (ctx: HarnessToolContext) =>
  tool({
    description: 'Git diff. Default unstaged (working tree vs index)',
    inputSchema: z.object({
      path: z.string().optional().describe('Optional path'),
      staged: z
        .boolean()
        .optional()
        .describe('Diff index instead of working tree; vs HEAD if no base'),
      base: z
        .string()
        .optional()
        .describe('Ref or range, e.g. HEAD (all uncommitted) or main...HEAD (branch)'),
    }),
    execute: async ({ path, staged, base }) =>
      gitDiffCommand({ projectRoot: ctx.projectRoot, path, staged, base }),
  })

export default gitDiff
