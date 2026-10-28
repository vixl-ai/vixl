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
import {
  notifyWorkspaceMutations,
  permissionPath,
  permissionPaths,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const applyPatch = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Apply an OpenCode-style patch (not git diff). Format: *** Update File: path, then @@ hunks with +/- lines.',
      ctx,
    ),
    inputSchema: z.object({
      patch: z.string().describe('OpenCode patch text'),
    }),
    execute: async ({ patch }, { toolCallId }) => {
      const diffs = mapDiffs(
        await fsStagePreviewApplyPatch(
          withProjectRoots({ projectRoot: ctx.projectRoot, patch }, ctx),
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
      await fsApplyPatch(withProjectRoots({ projectRoot: ctx.projectRoot, patch }, ctx))
      notifyWorkspaceMutations(ctx, gatedPaths)
      return {
        ok: true,
        paths,
        diffs: diffs.map((diff) => ({
          path: diff.path,
          operation: diff.operation,
          hunks: diff.hunks,
        })),
      }
    },
  })

export default applyPatch
