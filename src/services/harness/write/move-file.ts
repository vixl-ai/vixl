import { tool } from 'ai'
import { z } from 'zod'
import { fsMove } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
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

const moveFile = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootPathHint(
      'Move or rename a workspace file (requires approval)',
      ctx,
    ),
    inputSchema: z.object({
      from: z.string().describe(withMultiRootPathHint('Current path', ctx)),
      to: z.string().describe(withMultiRootPathHint('New path', ctx)),
    }),
    execute: async ({ from, to }, { toolCallId }) => {
      const gatedFrom = permissionPath(ctx.members, from)
      const gatedTo = permissionPath(ctx.members, to)
      const diffs: FileDiff[] = [
        {
          path: gatedFrom,
          operation: 'rename',
          newContent: gatedTo,
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              lines: [
                { kind: 'remove', content: gatedFrom },
                { kind: 'add', content: gatedTo },
              ],
            },
          ],
        },
      ]

      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'move_file',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability(gatedTo),
        title: `Move ${gatedFrom} -> ${gatedTo}`,
        paths: sensitiveCheckPaths(ctx.members, [from, to]),
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Move not approved' }
      }

      await captureBaselinesBeforeMutate(ctx, [from, to], toolCallId)
      await fsMove(withProjectRoots({ projectRoot: ctx.projectRoot, from, to }, ctx))
      notifyWorkspaceMutations(ctx, [gatedFrom, gatedTo])
      return { ok: true, from: gatedFrom, to: gatedTo, diffs }
    },
  })

export default moveFile
