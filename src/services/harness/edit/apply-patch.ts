import { tool } from 'ai'
import { z } from 'zod'
import { fsApplyPatch, fsStagePreviewApplyPatch } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import {
  fsDeleteCapability,
  fsWriteCapability,
} from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import { diffCounts, recordToolDiff } from '@/services/harness/shared/tool-diff-handoff'
import {
  notifyWorkspaceMutations,
  permissionPath,
  permissionPaths,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import { previewIgnoringSensitiveBlock } from '@/services/harness/ssh/preview'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const applyPatch = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Apply a multi-file patch (not git diff). Sections: *** Add File: path with + lines, ' +
        '*** Update File: path with @@ hunks, *** Delete File: path; optionally wrapped in ' +
        '*** Begin Patch / *** End Patch. In a hunk, - removes a line, + adds one, and any other ' +
        'line is context that must exist later in the file (written verbatim or with one leading ' +
        'space). @@ line numbers are ignored; hunks apply top to bottom.',
      ctx,
    ),
    inputSchema: z.object({
      patch: z.string().describe('Patch text; hunk grammar is in the tool description'),
    }),
    execute: async ({ patch }, { toolCallId }) => {
      const diffs = mapDiffs(
        await previewIgnoringSensitiveBlock(
          () =>
            fsStagePreviewApplyPatch(
              withProjectRoots({ projectRoot: ctx.projectRoot, patch }, ctx),
            ),
          [],
        ),
      )
      const paths = diffs.map((diff) => diff.path)
      const gatedPaths = permissionPaths(ctx.members, paths.length > 0 ? paths : ['**'])
      for (const diff of diffs) {
        if (diff.operation !== 'delete') {
          continue
        }
        const gatedPath = permissionPath(ctx.members, diff.path)
        const allowed = await gateToolPermission({
          ctx: toPermCtx(ctx),
          toolCallId,
          name: 'apply_patch',
          kind: 'fs',
          action: 'fs.delete',
          capability: fsDeleteCapability(gatedPath),
          title: `Delete ${gatedPath}`,
          paths: sensitiveCheckPaths(ctx.members, [diff.path]),
          diff: [diff],
        })
        if (!allowed) {
          return { rejected: true, error: 'Patch not approved' }
        }
      }
      const writeDiffs = diffs.filter((diff) => diff.operation !== 'delete')
      if (writeDiffs.length > 0) {
        const writePaths = writeDiffs.map((diff) => diff.path)
        const allowed = await gateToolPermission({
          ctx: toPermCtx(ctx),
          toolCallId,
          name: 'apply_patch',
          kind: 'fs',
          action: 'fs.write',
          capability: fsWriteCapability('*'),
          title: `Apply patch (${writePaths.length} file${writePaths.length !== 1 ? 's' : ''})`,
          paths: sensitiveCheckPaths(ctx.members, writePaths),
          diff: writeDiffs,
        })
        if (!allowed) {
          return { rejected: true, error: 'Patch not approved' }
        }
      }
      if (paths.length > 0) {
        await captureBaselinesBeforeMutate(ctx, paths, toolCallId)
      }
      await fsApplyPatch(
        withProjectRoots({ projectRoot: ctx.projectRoot, patch, allowSensitive: true }, ctx),
      )
      notifyWorkspaceMutations(ctx, gatedPaths)
      recordToolDiff(toolCallId, diffs)
      return {
        ok: true,
        paths,
        files: paths.length,
        ...diffCounts(diffs),
      }
    },
  })

export default applyPatch
