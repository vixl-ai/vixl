import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'

type WriteAgentsMdArgs = {
  scope: 'personal' | 'project'
  projectRoot?: string
}

const STARTER = `# Project instructions

Add repository-specific guidance for the agent here.
`

export default async (input: WriteAgentsMdArgs): Promise<{ path: string }> => {
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped AGENTS.md')
    }
    const path = '.vixl/AGENTS.md'
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path,
      content: STARTER,
    })
    return { path }
  }

  const personalDir = await getVixlDir('personal')
  const path = 'AGENTS.md'
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content: STARTER,
  })
  return { path }
}
