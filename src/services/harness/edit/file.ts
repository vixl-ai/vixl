import { tool } from 'ai'
import { z } from 'zod'
import { fsEditFile, fsStagePreviewEdit } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  permissionPath,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import withEditFileLock from './edit-file-lock'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const editFile = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint('Edit a file with exact string replacement.', ctx),
    inputSchema: z.object({
      path: z
        .string()
        .describe(withMultiRootPathHint('Workspace-relative file path', ctx)),
      old_string: z.string().describe('Exact text to find (must be unique in the file)'),
      new_string: z.string().describe('Replacement text'),
    }),
    execute: async ({ path, old_string, new_string }, { toolCallId }) => {
      const replacements = [{ oldString: old_string, newString: new_string }]
      const gatedPath = permissionPath(ctx.members, path)
      const lockKey = `${ctx.projectRoot}\0${gatedPath}`
      return withEditFileLock(lockKey, async () => {
        const previewDiffs = mapDiffs(
          await fsStagePreviewEdit(
            withProjectRoots(
              {
                projectRoot: ctx.projectRoot,
                path,
                replacements,
              },
              ctx,
            ),
          ),
        )
        const allowed = await gateToolPermission({
          ctx: toPermCtx(ctx),
          toolCallId,
          name: 'edit_file',
          kind: 'fs',
          action: 'fs.write',
          capability: fsWriteCapability(gatedPath),
          title: `Edit ${gatedPath}`,
          paths: sensitiveCheckPaths(ctx.members, [path]),
          diff: previewDiffs,
        })
        if (!allowed) {
          return { rejected: true, error: 'Edit not approved' }
        }
        await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
        const applied = await fsEditFile(
          withProjectRoots(
            {
              projectRoot: ctx.projectRoot,
              path,
              replacements,
            },
            ctx,
          ),
        )
        const diffs = mapDiffs([applied])
        const resultPath = diffs[0]?.path ?? path
        return { ok: true, path: resultPath, diffs }
      })
    },
  })

export default editFile
