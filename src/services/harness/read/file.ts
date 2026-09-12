import { tool } from 'ai'
import { z } from 'zod'
import { fsReadFile } from '@/services/vixl/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const imageReadResult = (args: {
  path: string
  mimeType: string | null
  sizeBytes: number | null
  content: string | null
  base64: string | null
}) => ({
  path: args.path,
  isImage: true as const,
  mimeType: args.mimeType,
  sizeBytes: args.sizeBytes,
  content: args.content,
  base64: args.base64,
})

const readFile = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Read a file from the workspace. For vision models, images are loaded into context automatically. Otherwise images return metadata, optionally with base64.',
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

      if (!result.isImage) {
        return result
      }

      if (!ctx.stageImage) {
        return imageReadResult({
          path: result.path,
          mimeType: result.mimeType ?? null,
          sizeBytes: result.sizeBytes ?? null,
          content: result.content || null,
          base64: result.base64 ?? null,
        })
      }

      let base64 = result.base64
      let mimeType = result.mimeType
      let sizeBytes = result.sizeBytes
      let resolvedPath = result.path

      if (!base64) {
        const withBase64 = await fsReadFile({
          projectRoot: ctx.projectRoot,
          path,
          includeBase64: true,
        })
        base64 = withBase64.base64
        mimeType = withBase64.mimeType ?? mimeType
        sizeBytes = withBase64.sizeBytes ?? sizeBytes
        resolvedPath = withBase64.path
      }

      if (!base64 || !mimeType) {
        return imageReadResult({
          path: resolvedPath,
          mimeType: mimeType ?? null,
          sizeBytes: sizeBytes ?? null,
          content: result.content || null,
          base64: base64 ?? null,
        })
      }

      try {
        await ctx.stageImage({
          dataUrl: `data:${mimeType};base64,${base64}`,
          mediaType: mimeType,
          source: resolvedPath,
        })
      } catch (error) {
        return {
          ...imageReadResult({
            path: resolvedPath,
            mimeType,
            sizeBytes: sizeBytes ?? null,
            content: result.content || null,
            base64: null,
          }),
          error:
            error instanceof Error
              ? error.message
              : 'Failed to load image into context',
        }
      }

      return {
        path: resolvedPath,
        isImage: true as const,
        loadedIntoContext: true as const,
        mimeType,
        sizeBytes: sizeBytes ?? null,
      }
    },
  })

export default readFile
