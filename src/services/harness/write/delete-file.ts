import { tool } from 'ai'
import { z } from 'zod'
import { fsDelete, fsStagePreviewDelete, fsStat } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsDeleteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate, {
  captureDirectoryBaseline,
} from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  ipcProjectRoots,
  notifyWorkspaceMutations,
  permissionPath,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import type { FileCheckpointCaptureResult } from '@/types/harness/file-checkpoint'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const deleteDiffsForCaptured = (
  captured: FileCheckpointCaptureResult['captured'],
): FileDiff[] =>
  captured.map((entry) => ({
    path: entry.path,
    operation: 'delete' as const,
    hunks: [],
  }))

const isRecursiveDirectory = async (
  ctx: HarnessToolContext,
  path: string,
  recursive: boolean | undefined,
): Promise<boolean> => {
  if (!recursive) {
    return false
  }
  const stat = await fsStat(ctx.projectRoot, path, ipcProjectRoots(ctx))
  return stat.exists && stat.kind === 'directory'
}

const MAX_SKIPPED_PATHS_IN_ERROR = 8

const refuseOversizeDirectoryDelete = (paths: string[]): { error: string } => {
  const shown = paths.slice(0, MAX_SKIPPED_PATHS_IN_ERROR)
  const extra = paths.length - shown.length
  const listed =
    extra > 0 ? `${shown.join(', ')}, and ${extra} more` : shown.join(', ')
  return {
    error: `Refusing to delete directory: ${paths.length} file(s) exceed the checkpoint size limit and would have no undo baseline: ${listed}`,
  }
}

const deleteFile = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Delete a file from the workspace (requires approval)',
      ctx,
    ),
    inputSchema: z.object({
      path: z.string().describe(withMultiRootPathHint('File to delete', ctx)),
      recursive: z
        .boolean()
        .optional()
        .describe(
          'Delete directories recursively. Refused if any file is too large to checkpoint.',
        ),
    }),
    execute: async ({ path, recursive }, { toolCallId }) => {
      const gatedPath = permissionPath(ctx.members, path)
      const recursiveDir = await isRecursiveDirectory(ctx, path, recursive)

      let diffs: FileDiff[]
      if (recursiveDir) {
        const captured = await captureDirectoryBaseline(ctx, path, toolCallId)
        if (captured.skippedOversize.length > 0) {
          return refuseOversizeDirectoryDelete(captured.skippedOversize)
        }
        diffs = deleteDiffsForCaptured(captured.captured)
      } else {
        try {
          diffs = mapDiffs(
            await fsStagePreviewDelete(
              withProjectRoots({ projectRoot: ctx.projectRoot, path }, ctx),
            ),
          )
        } catch {
          diffs = [{ path: gatedPath, operation: 'delete', hunks: [] }]
        }
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

      if (!recursiveDir) {
        await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      }
      await fsDelete(
        withProjectRoots({ projectRoot: ctx.projectRoot, path, recursive }, ctx),
      )
      notifyWorkspaceMutations(ctx, [gatedPath])
      const resultPath = recursiveDir ? gatedPath : (diffs[0]?.path ?? gatedPath)
      return { ok: true, path: resultPath, diffs }
    },
  })

export default deleteFile
