import { tool } from 'ai'
import { z } from 'zod'
import { fsStagePreviewWrite, fsWriteFile } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  notifyWorkspaceMutations,
  permissionPath,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const writeFile = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Create or overwrite a file (requires approval). Prefer edit_file for small changes.',
      ctx,
    ),
    inputSchema: z.object({
      path: z
        .string()
        .describe(withMultiRootPathHint('Workspace-relative file path', ctx)),
      content: z.string().describe('Full file contents to write'),
    }),
    execute: async ({ path, content }, { toolCallId }) => {
      const gatedPath = permissionPath(ctx.members, path)
      const diffs = mapDiffs(
        await fsStagePreviewWrite(
          withProjectRoots({ projectRoot: ctx.projectRoot, path, content }, ctx),
        ),
      )
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'write_file',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability(gatedPath),
        title: `Write ${gatedPath}`,
        paths: sensitiveCheckPaths(ctx.members, [path]),
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Write not approved' }
      }
      await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      await fsWriteFile(
        withProjectRoots({ projectRoot: ctx.projectRoot, path, content }, ctx),
      )
      notifyWorkspaceMutations(ctx, [gatedPath])
      const resultPath = diffs[0]?.path ?? path
      return { ok: true, path: resultPath, diffs }
    },
  })

export default writeFile
