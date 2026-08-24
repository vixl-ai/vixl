import { tool } from 'ai'
import { z } from 'zod'
import { workspaceGlob } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const globFiles = (ctx: HarnessToolContext) =>
  tool({
    description: 'Glob files in workspace',
    inputSchema: z.object({ pattern: z.string() }),
    execute: async ({ pattern }) => workspaceGlob(ctx.projectRoot, pattern),
  })

export default globFiles
