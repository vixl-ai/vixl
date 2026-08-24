import { tool } from 'ai'
import { z } from 'zod'
import { fsReadFile } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const readFile = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Read a file from the workspace. For image files (.png, .jpg, .jpeg, .gif, .webp, .svg), returns image metadata and optional base64 instead of plain text.',
    inputSchema: z.object({
      path: z.string().describe('Workspace-relative file path'),
      offset: z.number().optional().describe('1-based start line'),
      limit: z.number().optional().describe('Max lines to return'),
      include_base64: z.boolean().optional().describe('Include base64 for images'),
    }),
    execute: async ({ path, offset, limit, include_base64 }) => {
      const result = await fsReadFile({
        projectRoot: ctx.projectRoot,
        path,
        offset,
        limit,
        includeBase64: include_base64,
      })

      if (result.isImage) {
        return {
          path: result.path,
          isImage: true,
          mimeType: result.mimeType ?? null,
          sizeBytes: result.sizeBytes ?? null,
          content: result.content || null,
          base64: result.base64 ?? null,
        }
      }

      return result
    },
  })

export default readFile
