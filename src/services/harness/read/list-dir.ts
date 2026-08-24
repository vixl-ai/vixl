import { tool } from 'ai'
import { z } from 'zod'
import { fsListDir } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const listDir = (ctx: HarnessToolContext) =>
  tool({
    description: 'List a directory',
    inputSchema: z.object({
      path: z.string().default('.').describe('Workspace-relative directory path'),
    }),
    execute: async ({ path }) => fsListDir(ctx.projectRoot, path),
  })

export default listDir
