import { tool } from 'ai'
import { z } from 'zod'
import { toast } from 'vue-sonner'
import { moveChatToWorkspace, updateChatMeta } from '@/services/vixl/vixl-tauri'
import { gateWorkspaceMovePermission } from '@/services/harness/permission'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import filePathBasename from '@/utils/file-path-basename'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const isAbsoluteRootPath = (value: string): boolean => {
  if (value.startsWith('/') || value.startsWith('\\')) {
    return true
  }
  return /^[A-Za-z]:[/\\]/.test(value)
}

const joinOntoProjectRoot = (projectRoot: string, relativePath: string): string => {
  const useBackslash = /\\/.test(projectRoot) && !/\//.test(projectRoot)
  const separator = useBackslash ? '\\' : '/'
  const trimmedRoot = projectRoot.replace(/[/\\]+$/, '')
  const trimmedRelative = relativePath.replace(/^[/\\]+/, '')
  const normalizedRelative = useBackslash
    ? trimmedRelative.replace(/\//g, '\\')
    : trimmedRelative.replace(/\\/g, '/')
  if (!trimmedRoot) {
    return normalizedRelative
  }
  if (!normalizedRelative) {
    return trimmedRoot
  }
  return `${trimmedRoot}${separator}${normalizedRelative}`
}

const resolveRootPath = (
  rootPath: string,
  projectRoot: string,
): { error: string } | { resolved: string } => {
  const trimmed = rootPath.trim()
  if (!trimmed) {
    return { error: 'rootPath is required' }
  }
  if (isAbsoluteRootPath(trimmed)) {
    return { resolved: trimmed }
  }
  return { resolved: joinOntoProjectRoot(projectRoot, trimmed) }
}

const moveWorkspace = (ctx: HarnessToolContext) =>
  tool({
    description: 'Move this chat onto a different project folder (always user-approved).',
    inputSchema: z.object({
      rootPath: z
        .string()
        .describe("Absolute or workspace-relative folder that should become this chat's project"),
    }),
    execute: async ({ rootPath }, { toolCallId }) => {
      if (ctx.subagentId) {
        return { error: 'move_workspace can only run on the parent chat' }
      }

      const resolvedPath = resolveRootPath(rootPath, ctx.projectRoot)
      if ('error' in resolvedPath) {
        return { error: resolvedPath.error }
      }
      const resolved = resolvedPath.resolved
      const basename = filePathBasename(resolved) || resolved

      const allowed = await gateWorkspaceMovePermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'move_workspace',
        title: `Move this chat to ${basename}?`,
        detail: resolved,
      })
      if (!allowed) {
        return { rejected: true, error: 'User declined moving the workspace' }
      }

      const fromProjectSlug = ctx.projectSlug
      const moved = await moveChatToWorkspace({
        fromProjectSlug,
        chatId: ctx.chatId,
        rootPath: resolved,
      })

      ctx.projectRoot = moved.chat.projectRoot
      ctx.projectSlug = moved.chat.projectSlug

      try {
        await updateChatMeta(moved.chat.projectSlug, ctx.chatId, {
          prefixSnapshot: null,
        })
      } catch (error) {
        toast.error('Failed to clear chat prefix', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }

      try {
        await ctx.onHarnessEvent?.({
          type: 'workspace-moved',
          fromProjectSlug,
          chatId: ctx.chatId,
          project: {
            id: moved.project.id,
            name: moved.project.name,
            slug: moved.project.slug,
            rootPath: moved.project.rootPath,
          },
          projectSlug: moved.chat.projectSlug,
          projectRoot: moved.chat.projectRoot,
        })
      } catch (error: unknown) {
        return {
          error:
            error instanceof Error
              ? `Moved workspace files, but failed to rebind the session: ${error.message}`
              : 'Moved workspace files, but failed to rebind the session',
        }
      }

      return {
        ok: true,
        message: `Moved workspace to ${moved.chat.projectRoot}.`,
        projectSlug: moved.chat.projectSlug,
        projectRoot: moved.chat.projectRoot,
      }
    },
  })

export default moveWorkspace
