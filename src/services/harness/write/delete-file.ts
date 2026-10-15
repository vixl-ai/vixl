import { tool } from 'ai'
import { z } from 'zod'
import { fsDelete, fsStagePreviewDelete } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsDeleteCapability } from '@/services/harness/permission/policy'
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
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const deleteFile = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Delete a file from the workspace (requires approval)',
      ctx,
    ),
    inputSchema: z.object({
      path: z.string().describe(withMultiRootPathHint('File to delete', ctx)),
      recursive: z.boolean().optional().describe('Delete directories recursively'),
    }),
    execute: async ({ path, recursive }, { toolCallId }) => {
      const gatedPath = permissionPath(ctx.members, path)
      let diffs: FileDiff[]
      try {
        diffs = mapDiffs(
          await fsStagePreviewDelete(
            withProjectRoots({ projectRoot: ctx.projectRoot, path }, ctx),
          ),
        )
      } catch {
        diffs = [{ path: gatedPath, operation: 'delete', hunks: [] }]
      }

      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'delete_file',
        kind: 'fs',
        action: 'fs.delete',
        capability: fsDeleteCapability(gatedPath),
        title: `Delete ${gatedPath}`,
        paths: sensitiveCheckPaths(ctx.members, [path]),
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Delete not approved' }
      }

      await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      await fsDelete(
        withProjectRoots({ projectRoot: ctx.projectRoot, path, recursive }, ctx),
      )
      notifyWorkspaceMutations(ctx, [gatedPath])
      const resultPath = diffs[0]?.path ?? gatedPath
      return { ok: true, path: resultPath, diffs }
    },
  })

export default deleteFile
