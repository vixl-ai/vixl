import {
  HOME_PROJECT_SCOPE_ERROR,
  isHomeWorkspaceRoot,
} from '@/services/config/is-home-workspace-root'
import createPlan, { type CreatePlanInput } from '@/services/plans/write-plan'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'

type WritePlanFileArgs = CreatePlanInput & {
  scope: 'personal' | 'project'
  projectRoot?: string
}

type WritePlanFileResult = {
  planId: string
  path: string
}

export default async (input: WritePlanFileArgs): Promise<WritePlanFileResult> => {
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped plans')
    }
    if (await isHomeWorkspaceRoot(input.projectRoot)) {
      throw new Error(HOME_PROJECT_SCOPE_ERROR)
    }
    const plan = createPlan({
      title: input.title,
      body: input.body,
      todos: input.todos,
      sourceChatId: input.sourceChatId,
    })
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path: plan.path,
      content: plan.content,
    })
    return { planId: plan.planId, path: plan.path }
  }

  const plan = createPlan({
    title: input.title,
    body: input.body,
    todos: input.todos,
    sourceChatId: input.sourceChatId,
  })
  const personalDir = await getVixlDir('personal')
  const path = plan.path.replace(/^\.vixl\//, '')
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content: plan.content,
  })
  return { planId: plan.planId, path }
}
