import { tool } from 'ai'
import { z } from 'zod'
import { fsMove, fsStat } from '@/services/vixl/vixl-tauri'
import { gateToolPermission } from '@/services/harness/permission/gate'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import captureBaselinesBeforeMutate, {
  captureDirectoryBaseline,
} from '@/services/harness/capture-baselines-before-mutate'
import resolveMemberPath from '@/services/harness/resolve-member-path'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import {
  ipcProjectRoots,
  notifyWorkspaceMutations,
  permissionPath,
  sensitiveCheckPaths,
  withMultiRootPathHint,
  withProjectRoots,
} from '@/services/harness/tool-roots'
import type { FileDiff } from '@/types/harness/file-diff'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const renameDiff = (fromPath: string, toPath: string): FileDiff => ({
  path: fromPath,
  operation: 'rename',
  newContent: toPath,
  hunks: [
    {
      oldStart: 1,
      newStart: 1,
      lines: [
        { kind: 'remove', content: fromPath },
        { kind: 'add', content: toPath },
      ],
    },
  ],
})

const pathUnderMovedDir = (fromDir: string, toDir: string, filePath: string): string => {
  const fromBase = fromDir.replace(/\/+$/, '')
  const toBase = toDir.replace(/\/+$/, '')
  if (filePath === fromBase) {
    return toBase
  }
  const prefix = `${fromBase}/`
  if (filePath.startsWith(prefix)) {
    return `${toBase}/${filePath.slice(prefix.length)}`
  }
  return `${toBase}/${filePath}`
}

const isExistingDirectory = async (
  ctx: HarnessToolContext,
  path: string,
): Promise<boolean> => {
  const stat = await fsStat(ctx.projectRoot, path, ipcProjectRoots(ctx))
  return stat.exists && stat.kind === 'directory'
}

const MAX_SKIPPED_PATHS_IN_ERROR = 8

const refuseOversizeDirectoryMove = (paths: string[]): { error: string } => {
  const shown = paths.slice(0, MAX_SKIPPED_PATHS_IN_ERROR)
  const extra = paths.length - shown.length
  const listed =
    extra > 0 ? `${shown.join(', ')}, and ${extra} more` : shown.join(', ')
  return {
    error: `Refusing to move directory: ${paths.length} file(s) exceed the checkpoint size limit and would have no undo baseline: ${listed}`,
  }
}

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
      if (ctx.members && ctx.members.length >= 2) {
        const fromResolved = resolveMemberPath(ctx.members, from)
        const toResolved = resolveMemberPath(ctx.members, to)
        if (fromResolved.memberSlug !== toResolved.memberSlug) {
          return { error: 'Move paths must belong to a single project member' }
        }
      }

      const gatedFrom = permissionPath(ctx.members, from)
      const gatedTo = permissionPath(ctx.members, to)
      const movingDirectory = await isExistingDirectory(ctx, from)

      let diffs: FileDiff[]
      if (movingDirectory) {
        const captured = await captureDirectoryBaseline(ctx, from, toolCallId)
        if (captured.skippedOversize.length > 0) {
          return refuseOversizeDirectoryMove(captured.skippedOversize)
        }
        diffs = captured.captured.map((entry) =>
          renameDiff(entry.path, pathUnderMovedDir(gatedFrom, gatedTo, entry.path)),
        )
      } else {
        diffs = [renameDiff(gatedFrom, gatedTo)]
      }

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

      if (movingDirectory) {
        const destPaths = diffs
          .map((diff) => diff.newContent)
          .filter((path): path is string => typeof path === 'string' && path.length > 0)
        await captureBaselinesBeforeMutate(ctx, destPaths, toolCallId)
      } else {
        await captureBaselinesBeforeMutate(ctx, [from, to], toolCallId)
      }
      await fsMove(withProjectRoots({ projectRoot: ctx.projectRoot, from, to }, ctx))
      notifyWorkspaceMutations(ctx, [gatedFrom, gatedTo])
      return { ok: true, from: gatedFrom, to: gatedTo, diffs }
    },
  })

export default moveFile
