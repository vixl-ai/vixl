import { tool } from 'ai'
import { z } from 'zod'
import { fsMove } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const moveFile = (ctx: HarnessToolContext) =>
  tool({
    description: 'Move or rename a workspace file (requires approval)',
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
    }),
    execute: async ({ from, to }, { toolCallId }) => {
      const diffs: FileDiff[] = [
        {
          path: from,
          operation: 'rename',
          newContent: to,
          hunks: [
            {
              oldStart: 1,
              newStart: 1,
              lines: [
                { kind: 'remove', content: from },
                { kind: 'add', content: to },
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
        capability: fsWriteCapability(to),
        title: `Move ${from} → ${to}`,
        paths: [from, to],
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Move not approved' }
      }

      await captureBaselinesBeforeMutate(ctx, [from, to], toolCallId)
      await fsMove({ projectRoot: ctx.projectRoot, from, to })
      return { ok: true, from, to, diffs }
    },
  })

export default moveFile
