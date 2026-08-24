import { tool } from 'ai'
import { z } from 'zod'
import { fsStagePreviewWrite, fsWriteFile } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import withToolExamples from '@/services/harness/with-tool-examples'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const writeFile = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples('Create or overwrite a file (requires approval). Prefer edit_file for small changes.', [
      {
        path: 'src/utils/format-date.ts',
        content: "export default (value: Date): string => value.toISOString()\n",
      },
    ]),
    inputSchema: z.object({
      path: z.string().describe('Workspace-relative file path'),
      content: z.string().describe('Full file contents to write'),
    }),
    execute: async ({ path, content }, { toolCallId }) => {
      const diffs = mapDiffs(
        await fsStagePreviewWrite({ projectRoot: ctx.projectRoot, path, content }),
      )
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'write_file',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability(path),
        title: `Write ${path}`,
        paths: [path],
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Write not approved' }
      }
      await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      await fsWriteFile({ projectRoot: ctx.projectRoot, path, content })
      return { ok: true, path, diffs }
    },
  })

export default writeFile
