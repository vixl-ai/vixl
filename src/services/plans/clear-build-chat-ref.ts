import parsePlan from '@/services/plans/parse-plan'
import updatePlanFrontmatter from '@/services/plans/update-plan-frontmatter'
import { fsListDir, fsReadFile } from '@/services/vixl/vixl-tauri'

const PLANS_DIR = '.vixl/plans'

const lastBuildChatIdForPlan = async (
  projectRoot: string,
  path: string,
): Promise<string | null> => {
  try {
    const { content } = await fsReadFile({ projectRoot, path })
    return parsePlan(content).frontmatter?.lastBuildChatId ?? null
  } catch {
    return null
  }
}

export default async (args: {
  projectRoot: string
  chatId: string
}): Promise<void> => {
  let entries: Array<{ name: string; kind: string }>
  try {
    entries = await fsListDir(args.projectRoot, PLANS_DIR)
  } catch {
    return
  }

  for (const entry of entries) {
    if (entry.kind !== 'directory') {
      continue
    }
    const path = `${PLANS_DIR}/${entry.name}/PLAN.md`
    const lastBuildChatId = await lastBuildChatIdForPlan(args.projectRoot, path)
    if (lastBuildChatId !== args.chatId) {
      continue
    }
    await updatePlanFrontmatter({
      projectRoot: args.projectRoot,
      path,
        patch: {
          lastBuildChatId: null,
          lastBuildChatSlug: null,
          builtAt: null,
        },
    })
  }
}
