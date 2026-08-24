import { tool } from 'ai'
import { z } from 'zod'
import { fsWriteFile } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import isStudioHtmlContent from '@/services/studio/is-studio-html-content'
import parseStudioArtifact from '@/services/studio/parse-studio-artifact'
import validateStudioBlocks from '@/services/studio/validate-studio-blocks'
import validateStudioSlug from '@/services/studio/validate-studio-slug'
import studioDataSchema from '@/schemas/studio/studio-data'
import withToolExamples from '@/services/harness/with-tool-examples'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const writeStudioArtifact = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      'Publish a Comark studio artifact to .vixl/studio/<slug>/index.md. Call load_skill("studio-blocks") for the block catalog. Optional data sidecar writes data.json. Never use HTML.',
      [
        {
          slug: 'launch-brief',
          content:
            '---\ntitle: Launch brief\n---\n\n# Launch brief\n\nShort prose artifact.\n',
        },
        {
          slug: 'metrics-dashboard',
          content:
            '---\ntitle: Metrics\n---\n\n# Metrics\n\n```table\n| Metric | Value |\n| --- | --- |\n| Users | 1200 |\n```\n',
          data: { users: 1200 },
        },
      ],
    ),
    inputSchema: z.object({
      slug: z.string().describe('URL-safe studio slug'),
      content: z.string().describe('Comark markdown with optional frontmatter'),
      data: z.record(z.unknown()).optional().describe('Optional data.json sidecar object'),
    }),
    execute: async ({ slug, content, data: sidecar }) => {
      const slugError = validateStudioSlug(slug)
      if (slugError) {
        return { error: slugError }
      }
      if (isStudioHtmlContent(content)) {
        return {
          error:
            'Studio artifacts must be Comark markdown, not HTML. Call load_skill("studio-blocks") for block syntax.',
        }
      }

      const parsed = parseStudioArtifact(content)
      if (parsed.parseError) {
        return { error: parsed.parseError }
      }

      const blockError = await validateStudioBlocks(parsed.body)
      if (blockError) {
        return { error: blockError }
      }

      if (sidecar) {
        const dataResult = studioDataSchema.safeParse(sidecar)
        if (!dataResult.success) {
          return { error: 'Invalid studio data sidecar: expected a JSON object' }
        }
      }

      const path = `.vixl/studio/${slug}/index.md`
      await fsWriteFile({ projectRoot: ctx.projectRoot, path, content })
      if (sidecar) {
        await fsWriteFile({
          projectRoot: ctx.projectRoot,
          path: `.vixl/studio/${slug}/data.json`,
          content: `${JSON.stringify(sidecar, null, 2)}\n`,
        })
      }

      const workbench = useWorkbenchStore()
      const projectId = workbench.resolveProjectIdByRoot(ctx.projectRoot)
      const parsedTitle = content.match(/^---[\s\S]*?title:\s*(.+)$/m)?.[1]?.trim()
      if (projectId) {
        workbench.openStudio(projectId, slug, path, parsedTitle ?? slug)
      }
      return {
        slug,
        path,
        dataPath: sidecar ? `.vixl/studio/${slug}/data.json` : null,
      }
    },
  })

export default writeStudioArtifact
