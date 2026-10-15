import { tool } from 'ai'
import { z } from 'zod'
import { workspaceGrep } from '@/services/vixl/vixl-tauri'
import { withMultiRootPathHint, withProjectRoots } from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const grep = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint('Search workspace with ripgrep', ctx),
    inputSchema: z.object({
      pattern: z.string().describe('Ripgrep pattern'),
      glob: z.string().optional().describe('Optional glob filter'),
    }),
    execute: async ({ pattern, glob }) =>
      workspaceGrep(
        withProjectRoots({ projectRoot: ctx.projectRoot, pattern, glob }, ctx),
      ),
  })

export default grep
