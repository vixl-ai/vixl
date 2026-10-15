import { tool } from 'ai'
import { z } from 'zod'
import { fsListDir } from '@/services/vixl/vixl-tauri'
import {
  ipcProjectRoots,
  isMultiRootWorkspace,
  withMultiRootPathHint,
  withMultiRootSuffix,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const LIST_MEMBERS_HINT =
  'Omit path or pass . to list workspace members as top-level directories.'

const listsWorkspaceMembers = (path: string): boolean => {
  const trimmed = path.trim()
  return trimmed.length === 0 || trimmed === '.' || trimmed === './'
}

const listDir = (ctx: HarnessToolContext) =>
  tool({
    description: withMultiRootSuffix(
      withMultiRootPathHint('List a directory', ctx),
      ctx,
      LIST_MEMBERS_HINT,
    ),
    inputSchema: z.object({
      path: z
        .string()
        .default('.')
        .describe(
          withMultiRootSuffix(
            withMultiRootPathHint('Workspace-relative directory path', ctx),
            ctx,
            LIST_MEMBERS_HINT,
          ),
        ),
    }),
    execute: async ({ path }) => {
      if (isMultiRootWorkspace(ctx) && listsWorkspaceMembers(path)) {
        return (ctx.members ?? []).map((member) => ({
          name: member.slug,
          path: member.slug,
          kind: 'directory',
        }))
      }
      return fsListDir(ctx.projectRoot, path, ipcProjectRoots(ctx))
    },
  })

export default listDir
