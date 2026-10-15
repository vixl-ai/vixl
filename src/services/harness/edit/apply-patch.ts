import { tool } from 'ai'
import { z } from 'zod'
import { fsApplyPatch, fsStagePreviewApplyPatch } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  notifyWorkspaceMutations,
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
      const checkPaths = paths.length > 0 ? paths : ['**']
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'apply_patch',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability('*'),
        title: `Apply patch (${paths.length} file${paths.length !== 1 ? 's' : ''})`,
        paths: sensitiveCheckPaths(ctx.members, checkPaths),
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Patch not approved' }
      }
      if (paths.length > 0) {
        await captureBaselinesBeforeMutate(ctx, paths, toolCallId)
      }
      await fsApplyPatch(withProjectRoots({ projectRoot: ctx.projectRoot, patch }, ctx))
      notifyWorkspaceMutations(ctx, gatedPaths)
      return { ok: true, paths, diffs }
    },
  })

export default applyPatch
