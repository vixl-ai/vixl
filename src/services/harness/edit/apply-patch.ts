import { tool } from 'ai'
import { z } from 'zod'
import { fsApplyPatch, fsStagePreviewApplyPatch } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import withToolExamples from '@/services/harness/with-tool-examples'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const applyPatch = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      'Apply an OpenCode-style patch (NOT git diff). Use headers like *** Update File: path/to/file.ts with +/- hunks.',
      [
        {
          patch:
            '*** Update File: src/utils/hello.ts\n@@\n-export const hello = () => "hi"\n+export const hello = () => "hello"\n',
        },
      ],
    ),
    inputSchema: z.object({
      patch: z.string().describe('OpenCode-style multi-file patch text'),
    }),
    execute: async ({ patch }, { toolCallId }) => {
      const diffs = mapDiffs(
        await fsStagePreviewApplyPatch({ projectRoot: ctx.projectRoot, patch }),
      )
      const paths = diffs.map((diff) => diff.path)
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'apply_patch',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability('*'),
        title: `Apply patch (${paths.length} file${paths.length !== 1 ? 's' : ''})`,
        paths: paths.length > 0 ? paths : ['**'],
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Patch not approved' }
      }
      if (paths.length > 0) {
        await captureBaselinesBeforeMutate(ctx, paths, toolCallId)
      }
      await fsApplyPatch({ projectRoot: ctx.projectRoot, patch })
      return { ok: true, paths, diffs }
    },
  })

export default applyPatch
