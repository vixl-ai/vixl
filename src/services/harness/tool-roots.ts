import { z } from 'zod'
import resolveMemberPath from '@/services/harness/resolve-member-path'
import { notifyWorkspaceFsMutation } from '@/services/harness/shared/notify-fs-mutation'
import { hasGroupMembers, isLiveMemberRoot } from '@/utils/parse-member-qualified-name'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export type IpcProjectRoot = {
  slug: string
  path: string
}

export const MULTI_ROOT_PATH_HINT =
  'In a multi-project workspace, paths must be prefixed with a project slug (for example api/src/index.ts).'

export const REPO_TOOL_HINT =
  'Optional repo is a project slug; defaults to the primary project.'

export const isMultiRootWorkspace = (
  ctx: Pick<HarnessToolContext, 'members'>,
): boolean => hasGroupMembers(ctx.members)

export const withMultiRootPathHint = (
  base: string,
  ctx: Pick<HarnessToolContext, 'members'>,
): string => (isMultiRootWorkspace(ctx) ? `${base} ${MULTI_ROOT_PATH_HINT}` : base)

export const withMultiRootSuffix = (
  base: string,
  ctx: Pick<HarnessToolContext, 'members'>,
  suffix: string,
): string => (isMultiRootWorkspace(ctx) ? `${base} ${suffix}` : base)

export const repoSlugFields = (
  ctx: Pick<HarnessToolContext, 'members'>,
): { repo: z.ZodOptional<z.ZodString> } | Record<string, never> =>
  isMultiRootWorkspace(ctx)
    ? {
        repo: z
          .string()
          .optional()
          .describe('Project slug of the git repo. Defaults to the primary project.'),
      }
    : {}

export const cwdSlugFields = (
  ctx: Pick<HarnessToolContext, 'members'>,
): { cwd: z.ZodOptional<z.ZodString> } | Record<string, never> =>
  isMultiRootWorkspace(ctx)
    ? {
        cwd: z
          .string()
          .optional()
          .describe(
            'Project slug to use as the working directory. Defaults to the primary project. Each call is independent.',
          ),
      }
    : {}

export const slugArg = (input: object, key: 'repo' | 'cwd'): string | undefined => {
  if (!(key in input)) {
    return undefined
  }
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

const formatValidSlugs = (members: HarnessWorkspaceMember[]): string =>
  members.map((member) => member.slug).join(', ')

export const ipcProjectRoots = (
  ctx: Pick<HarnessToolContext, 'members'>,
): IpcProjectRoot[] | undefined => {
  if (!ctx.members || ctx.members.length === 0) {
    return undefined
  }
  return ctx.members.map((member) => ({
    slug: member.slug,
    path: member.rootPath,
  }))
}

export const withProjectRoots = <T extends Record<string, unknown>>(
  args: T,
  ctx: Pick<HarnessToolContext, 'members'>,
): T & { projectRoots?: IpcProjectRoot[] } => {
  const projectRoots = ipcProjectRoots(ctx)
  if (!projectRoots) {
    return args
  }
  return { ...args, projectRoots }
}

export const resolveWorkspaceSlug = (
  ctx: Pick<HarnessToolContext, 'projectRoot' | 'members'>,
  slug?: string,
): { projectRoot: string; slug: string | undefined } => {
  const members = ctx.members
  if (!members || members.length === 0) {
    return { projectRoot: ctx.projectRoot, slug: undefined }
  }

  const resolvedSlug =
    slug ??
    members.find(
      (member) => isLiveMemberRoot(member.rootPath) && member.rootPath === ctx.projectRoot,
    )?.slug ??
    members[0]!.slug

  const member = members.find((entry) => entry.slug === resolvedSlug)
  if (!member) {
    throw new Error(`Unknown project slug. Valid slugs: ${formatValidSlugs(members)}`)
  }
  if (!isLiveMemberRoot(member.rootPath)) {
    throw new Error(`Project ${member.slug} is no longer available`)
  }
  return { projectRoot: member.rootPath, slug: member.slug }
}

export const permissionPath = (
  members: HarnessWorkspaceMember[] | undefined,
  userPath: string,
): string => {
  if (!members || members.length === 0) {
    return userPath
  }
  try {
    const resolved = resolveMemberPath(members, userPath)
    if (!resolved.relativePath) {
      return resolved.memberSlug
    }
    return `${resolved.memberSlug}/${resolved.relativePath}`
  } catch {
    return userPath
  }
}

export const permissionPaths = (
  members: HarnessWorkspaceMember[] | undefined,
  paths: string[],
): string[] => paths.map((path) => permissionPath(members, path))

export const sensitiveCheckPath = (
  members: HarnessWorkspaceMember[] | undefined,
  userPath: string,
): string => {
  if (!members || members.length === 0) {
    return userPath
  }
  try {
    return resolveMemberPath(members, userPath).relativePath
  } catch {
    return userPath
  }
}

export const sensitiveCheckPaths = (
  members: HarnessWorkspaceMember[] | undefined,
  paths: string[],
): string[] => paths.map((path) => sensitiveCheckPath(members, path))

export type CheckpointCaptureTarget = {
  projectRoot: string
  path: string
  key: string
}

const checkpointManifestKey = (
  members: HarnessWorkspaceMember[] | undefined,
  memberSlug: string,
  relativePath: string,
): string => {
  if (!hasGroupMembers(members)) {
    return relativePath
  }
  if (!relativePath) {
    return memberSlug
  }
  return `${memberSlug}/${relativePath}`
}

export const checkpointCaptureTarget = (
  ctx: Pick<HarnessToolContext, 'projectRoot' | 'members'>,
  userPath: string,
): CheckpointCaptureTarget => {
  if (!ctx.members || ctx.members.length === 0) {
    return { projectRoot: ctx.projectRoot, path: userPath, key: userPath }
  }
  try {
    const resolved = resolveMemberPath(ctx.members, userPath)
    return {
      projectRoot: resolved.root,
      path: resolved.relativePath,
      key: checkpointManifestKey(ctx.members, resolved.memberSlug, resolved.relativePath),
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('is no longer available')) {
      throw error
    }
    return { projectRoot: ctx.projectRoot, path: userPath, key: userPath }
  }
}

export const notifyWorkspaceMutations = (
  ctx: Pick<HarnessToolContext, 'projectRoot' | 'members'>,
  paths: string[],
): void => {
  if (!isMultiRootWorkspace(ctx)) {
    notifyWorkspaceFsMutation(ctx.projectRoot, paths)
    return
  }

  const grouped = new Map<string, string[]>()
  for (const path of paths) {
    const target = checkpointCaptureTarget(ctx, path)
    const existing = grouped.get(target.projectRoot) ?? []
    existing.push(target.path)
    grouped.set(target.projectRoot, existing)
  }
  for (const [root, memberPaths] of grouped) {
    notifyWorkspaceFsMutation(root, memberPaths)
  }
}
