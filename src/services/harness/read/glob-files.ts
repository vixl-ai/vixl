import { tool } from 'ai'
import { z } from 'zod'
import { workspaceGlob } from '@/services/vixl/vixl-tauri'
import { ipcProjectRoots, withMultiRootPathHint } from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const globFiles = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint('Glob files in workspace', ctx),
    inputSchema: z.object({ pattern: z.string().describe('Glob pattern') }),
    execute: async ({ pattern }) =>
      workspaceGlob(ctx.projectRoot, pattern, undefined, ipcProjectRoots(ctx)),
  })

export default globFiles
