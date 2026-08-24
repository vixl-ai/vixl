import { tool } from 'ai'
import { z } from 'zod'
import { fsEditFile, fsStagePreviewEdit } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'
import withToolExamples from '@/services/harness/with-tool-examples'
import mapDiffs from '@/services/harness/shared/map-diffs'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const editFile = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      'Edit a file with exact string replacement. old_string must match the file uniquely.',
      [
        {
          path: 'src/services/harness/tool-catalog.ts',
          old_string: "edit_file: 'Edit a file with search/replace',",
          new_string: "edit_file: 'Edit a file with exact string replacement',",
        },
      ],
    ),
    inputSchema: z.object({
      path: z.string().describe('Workspace-relative file path'),
      old_string: z.string().describe('Exact text to find (must be unique in the file)'),
      new_string: z.string().describe('Replacement text'),
    }),
    execute: async ({ path, old_string, new_string }, { toolCallId }) => {
      const replacements = [{ oldString: old_string, newString: new_string }]
      const diffs = mapDiffs(
        await fsStagePreviewEdit({
          projectRoot: ctx.projectRoot,
          path,
          replacements,
        }),
      )
      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'edit_file',
        kind: 'fs',
        action: 'fs.write',
        capability: fsWriteCapability(path),
        title: `Edit ${path}`,
        paths: [path],
        diff: diffs,
      })
      if (!allowed) {
        return { rejected: true, error: 'Edit not approved' }
      }
      await captureBaselinesBeforeMutate(ctx, [path], toolCallId)
      await fsEditFile({
        projectRoot: ctx.projectRoot,
        path,
        replacements,
      })
      return { ok: true, path, diffs }
    },
  })

export default editFile
