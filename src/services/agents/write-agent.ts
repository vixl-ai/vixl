import createAgentInputSchema, {
  type CreateAgentInput,
} from '@/schemas/agents/create-agent-input'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'
import slugifyName from '@/utils/slugify-name'

type WriteAgentArgs = CreateAgentInput & {
  scope: 'personal' | 'project'
  projectRoot?: string
}

type WriteAgentResult = {
  slug: string
  path: string
}

const formatAgentDocument = (input: CreateAgentInput): string => {
  const lines = [
    `name: ${JSON.stringify(input.name)}`,
    `description: ${JSON.stringify(input.description)}`,
  ]
  if (input.model) {
    lines.push(`model: ${JSON.stringify(input.model)}`)
  }
  if (input.reasoning) {
    lines.push(`reasoning: ${input.reasoning}`)
  }
  if (input.tools && input.tools.length > 0) {
    lines.push(`tools: ${JSON.stringify(input.tools)}`)
  }
  const body = input.body.trim()
  return `---
${lines.join('\n')}
---

${body}
`
}

export default async (input: WriteAgentArgs): Promise<WriteAgentResult> => {
  const validated = createAgentInputSchema.safeParse({
    name: input.name,
    description: input.description,
    body: input.body,
    model: input.model,
    reasoning: input.reasoning,
    tools: input.tools,
  })
  if (!validated.success) {
    throw new Error(
      `Invalid agent input: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const slug = slugifyName(validated.data.name)
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped agents')
    }
    const path = `.vixl/agents/${slug}.md`
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path,
      content: formatAgentDocument(validated.data),
    })
    return { slug, path }
  }

  const personalDir = await getVixlDir('personal')
  const path = `agents/${slug}.md`
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content: formatAgentDocument(validated.data),
  })
  return { slug, path }
}
