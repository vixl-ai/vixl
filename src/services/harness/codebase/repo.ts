import {
  isMultiRootWorkspace,
  REPO_TOOL_HINT,
  repoSlugFields,
} from '@/services/harness/tool-roots'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export { REPO_TOOL_HINT, repoSlugFields }

export const describeRepoTool = (
  base: string,
  ctx: Pick<HarnessToolContext, 'members'>,
): string => (isMultiRootWorkspace(ctx) ? `${base} ${REPO_TOOL_HINT}` : base)
