import { tool } from 'ai'
import { z } from 'zod'
import { fsDelete, fsStagePreviewDelete } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsDeleteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const deleteFile = (ctx: HarnessToolContext) =>
  tool({
    description: 'Delete a file from the workspace (requires approval)',
    inputSchema: z.object({
      path: z.string(),
      recursive: z.boolean().optional(),
    }),
    execute: async ({ path, recursive }, { toolCallId }) => {
      let diffs: FileDiff[]
      try {
        diffs = mapDiffs(
          await fsStagePreviewDelete({ projectRoot: ctx.projectRoot, path }),
        )
      } catch {
        diffs = [{ path, operation: 'delete', hunks: [] }]
      }

      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'delete_file',
        kind: 'fs',
        action: 'fs.delete',
        capability: fsDeleteCapability(path),
        title: `Delete ${path}`,
        paths: [path],
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Delete not approved' }
      }

      await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      await fsDelete({ projectRoot: ctx.projectRoot, path, recursive })
      return { ok: true, path, diffs }
    },
  })

export default deleteFile
