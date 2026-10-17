import {
  isMultiRootWorkspace,
  REPO_TOOL_HINT,
  repoSlugFields,
  withMultiRootSuffix,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export { REPO_TOOL_HINT, repoSlugFields }

export const describeRepoTool = (
  base: string,
  ctx: Pick<HarnessToolContext, 'members'>,
): string => withMultiRootSuffix(base, ctx, REPO_TOOL_HINT)

export const repoScopeSummary = (
  ctx: Pick<HarnessToolContext, 'members'>,
  requestedRepo: string | undefined,
  resolvedSlug: string | undefined,
  verb: string,
  base: string,
): string => {
  if (!resolvedSlug) {
    return base
  }
  if (requestedRepo === undefined && isMultiRootWorkspace(ctx)) {
    return `${base} in ${resolvedSlug} (default repo; pass repo to ${verb} another member)`
  }
  return `${base} in ${resolvedSlug}`
}

export const withRepoSlug = <T extends object>(
  slug: string | undefined,
  payload: T,
): T & { repo?: string } => (slug ? { ...payload, repo: slug } : payload)
